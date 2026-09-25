import { describe, expect, it } from "vitest";
import { extractDocument } from "@/lib/extract/extract-document";
import { textContainsToken } from "@/lib/extract/numbers";
import type { ExtractionResult, TextAtom } from "@/lib/extract/types";

function text(page: number, y: number, x: number, str: string, width?: number): TextAtom {
  return {
    page,
    str,
    x,
    y,
    width: width ?? str.length * 7,
    height: 12,
  };
}

function invoice(rows: Array<Array<[string, number]>>, extras: TextAtom[] = []): TextAtom[] {
  const header: Array<[string, number]> = [
    ["Description", 40],
    ["Qty", 300],
    ["Amount", 460],
  ];
  const atoms = [header, ...rows].flatMap((row, index) =>
    row.map(([str, x]) => text(1, 700 - index * 28, x, str)),
  );
  return [...atoms, ...extras];
}

function quantities(result: ExtractionResult): string[] {
  return result.lineItems.map((item) => item.quantity.value);
}

function assertEveryNumberIsSourced(result: ExtractionResult) {
  for (const item of result.lineItems) {
    expect(item.quantity.sourceText.includes(item.quantity.value)).toBe(true);
    expect(item.description.sourceText).toContain(item.description.value);
    expect(item.quantity.page).toBeGreaterThan(0);
    if (item.unitPrice) expect(item.unitPrice.sourceText.includes(item.unitPrice.value)).toBe(true);
    if (item.amount) expect(item.amount.sourceText.includes(item.amount.value)).toBe(true);
    if (item.unit) expect(item.unit.sourceText).toContain(item.unit.value);
  }
  for (const figure of result.printedFigures) {
    expect(figure.sourceText.includes(figure.value)).toBe(true);
    expect(figure.page).toBeGreaterThan(0);
  }
}

describe("refusal rules", () => {
  it("extracts a printed quantity with its page and source text", () => {
    const result = extractDocument(
      invoice([
        [
          ["Pine 90x45", 40],
          ["24", 300],
          ["204.00", 460],
        ],
      ]),
      1,
    );

    expect(quantities(result)).toEqual(["24"]);
    expect(result.lineItems[0]?.description.value).toBe("Pine 90x45");
    expect(result.lineItems[0]?.quantity.page).toBe(1);
    expect(result.lineItems[0]?.quantity.sourceText).toContain("Pine 90x45");
    expect((result.lineItems[0]?.quantity.sourceText ?? "").includes("24")).toBe(true);
    expect(result.lineItems[0]?.amount?.value).toBe("204.00");
    expect(result.refusals).toEqual([]);
    assertEveryNumberIsSourced(result);
  });

  it("does not treat a size in the description as the quantity", () => {
    const result = extractDocument(
      invoice([
        [
          ["Pine 90x45", 40],
          ["24", 300],
        ],
      ]),
      1,
    );

    expect(quantities(result)).toEqual(["24"]);
    expect(JSON.stringify(result.lineItems)).not.toContain('"value":"90"');
    expect(JSON.stringify(result.lineItems)).not.toContain('"value":"45"');
  });

  it("refuses a missing quantity and keeps the other rows", () => {
    const result = extractDocument(
      invoice([
        [
          ["Pine 90x45", 40],
          ["24", 300],
        ],
        [["Nails 75mm", 40]],
        [
          ["Bolts", 40],
          ["7", 300],
        ],
      ]),
      1,
    );

    expect(quantities(result)).toEqual(["24", "7"]);
    expect(result.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/No quantity was printed for “Nails 75mm”/);
    assertEveryNumberIsSourced(result);
  });

  it("refuses a range, an estimate, a word, and two numbers in one cell", () => {
    const result = extractDocument(
      invoice([
        [
          ["Cement", 40],
          ["10-12", 300],
        ],
        [
          ["Sand", 40],
          ["about 8", 300],
        ],
        [
          ["Mesh", 40],
          ["twelve", 300],
        ],
        [
          ["Ties", 40],
          ["2 x 10", 300],
        ],
        [
          ["Bricks", 40],
          ["50", 300],
        ],
      ]),
      1,
    );

    expect(quantities(result)).toEqual(["50"]);
    const explanations = result.refusals.map((refusal) => refusal.explanation).join(" ");
    expect(explanations).toMatch(/range/);
    expect(explanations).toMatch(/approximate/);
    expect(explanations).toMatch(/not a printed number/);
    expect(explanations).toMatch(/more than one number/);
    expect(JSON.stringify(result.lineItems)).not.toContain("10");
    expect(JSON.stringify(result.lineItems)).not.toContain("12");
    expect(JSON.stringify(result.lineItems)).not.toContain("8");
  });

  it("refuses ordered and delivered quantities that disagree, without adding them", () => {
    const result = extractDocument(
      [
        text(1, 700, 40, "Description"),
        text(1, 700, 280, "Ordered"),
        text(1, 700, 400, "Delivered"),
        text(1, 670, 40, "Cement 20kg"),
        text(1, 670, 280, "10"),
        text(1, 670, 400, "8"),
        text(1, 640, 40, "Sand"),
        text(1, 640, 280, "3"),
        text(1, 640, 400, "3"),
      ],
      1,
    );

    expect(quantities(result)).toEqual(["3"]);
    expect(result.lineItems[0]?.quantity.sourceText).toContain("3");
    expect(result.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/disagree/);
    expect(JSON.stringify(result.lineItems)).not.toContain("10");
    expect(JSON.stringify(result.lineItems)).not.toContain("8");
    expect(JSON.stringify(result.lineItems)).not.toContain("18");
  });

  it("refuses a page with no quantity heading and does not scrape a loose number", () => {
    const result = extractDocument([text(1, 700, 40, "Please supply 12 boxes of nails", 280)], 1);

    expect(result.lineItems).toEqual([]);
    expect(result.printedFigures).toEqual([]);
    expect(result.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/no headings/);
    expect(JSON.stringify(result.lineItems)).not.toContain("12");
  });

  it("refuses a quantity mentioned outside the table", () => {
    const result = extractDocument(
      [
        ...invoice([
          [
            ["Pine 90x45", 40],
            ["24", 300],
          ],
        ]),
        text(1, 500, 40, "Quantity 9 held back", 180),
      ],
      1,
    );

    expect(quantities(result)).toEqual(["24"]);
    expect(result.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/outside a labeled table/);
    expect(result.lineItems.map((item) => item.quantity.value)).not.toContain("9");
    expect(result.printedFigures.map((figure) => figure.value)).not.toContain("9");
  });

  it("refuses a row that sits between columns and keeps the clear row", () => {
    const clear = invoice([
      [
        ["Pine 90x45", 40],
        ["24", 300],
      ],
    ]);
    const boundary = (117 + 300) / 2;
    const straddling = text(1, 644, boundary - 7, "12");
    const description = text(1, 644, 40, "Bolts");
    const result = extractDocument([...clear, description, straddling], 1);

    expect(quantities(result)).toEqual(["24"]);
    expect(result.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/does not sit clearly/);
  });

  it("keeps a bad unit price from removing a sourced quantity", () => {
    const result = extractDocument(
      [
        text(1, 700, 40, "Description"),
        text(1, 700, 300, "Qty"),
        text(1, 700, 420, "Price"),
        text(1, 670, 40, "Pine"),
        text(1, 670, 300, "4"),
        text(1, 670, 420, "3 9"),
      ],
      1,
    );

    expect(quantities(result)).toEqual(["4"]);
    expect(result.lineItems[0]?.unitPrice).toBeNull();
    expect(result.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/unit price/);
  });

  it("reads a whitespace-aligned row without taking the size as the quantity", () => {
    const result = extractDocument(
      [
        text(1, 700, 40, "Description    Qty", 420),
        text(1, 670, 40, "Pine 90x45    24", 420),
      ],
      1,
    );

    expect(quantities(result)).toEqual(["24"]);
    expect(result.lineItems[0]?.quantity.sourceText).toContain("Pine 90x45");
    expect((result.lineItems[0]?.quantity.sourceText ?? "").includes("24")).toBe(true);
    expect(result.lineItems[0]?.description.value).toBe("Pine 90x45");
  });

  it("refuses a scanned page and still reads the page that has text", () => {
    const result = extractDocument(
      invoice([
        [
          ["Pine", 40],
          ["24", 300],
        ],
      ]),
      2,
    );

    expect(quantities(result)).toEqual(["24"]);
    expect(result.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/Page 2 has no readable text/);
  });

  it("does not accept a shorter number as evidence for a longer one", () => {
    expect(textContainsToken("50", "Quantity 500")).toBe(false);
    expect(textContainsToken("500", "Quantity 500")).toBe(true);
    expect(textContainsToken("12", "12.00")).toBe(false);
    expect(textContainsToken("1,250.00", "TOTAL $1,250.00")).toBe(true);
    expect(textContainsToken("24", "Pine 2400x1200")).toBe(false);
  });

  it("refuses an empty document instead of inventing line items", () => {
    const result = extractDocument([], 1);
    expect(result.lineItems).toEqual([]);
    expect(result.refusals[0]?.explanation).toMatch(/No text could be read/);
  });
});
