import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractDocument } from "@/lib/extract/extract-document";
import { textContainsToken } from "@/lib/extract/numbers";
import { readPdfAtoms } from "@/lib/pdf/read-pdf";

const sampleNames = ["KBS-10234.pdf", "KBS-10241.pdf", "KBS-10262.pdf", "KBS-10270.pdf", "KBS-DR118.pdf"];

describe("samples still match the checks", () => {
  it.skipIf(sampleNames.some((name) => !existsSync(name)))("keeps evidenced rows and the known refusals", async () => {
    async function read(name: string) {
      const bytes = new Uint8Array(await readFile(name));
      const { atoms, pageCount } = await readPdfAtoms(bytes);
      return extractDocument(atoms, pageCount);
    }

    const clean = await read("KBS-10234.pdf");
    expect(clean.lineItems.map((item) => item.quantity.value)).toEqual(["48", "12", "36", "20", "8"]);
    expect(clean.printedFigures.map((figure) => figure.value)).toEqual(["2,630.00"]);
    expect(clean.refusals).toEqual([]);
    for (const item of clean.lineItems) {
      expect(textContainsToken(item.quantity.value, item.quantity.sourceText)).toBe(true);
    }

    const scan = await read("KBS-10241.pdf");
    expect(scan.lineItems).toEqual([]);
    expect(scan.refusals[0]?.explanation).toMatch(/No text could be read/);

    const mismatch = await read("KBS-10270.pdf");
    expect(mismatch.printedFigures.map((figure) => figure.value)).toEqual(["1,612.90"]);
    expect(mismatch.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/does not match/);
    expect(JSON.stringify(mismatch)).not.toContain("1,538.20");

    const pallets = await read("KBS-10262.pdf");
    expect(pallets.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/14/);
    expect(pallets.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/16/);
    expect(pallets.lineItems.map((item) => item.quantity.value)).not.toContain("14");

    const docket = await read("KBS-DR118.pdf");
    expect(docket.lineItems).toHaveLength(21);
    expect(docket.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/Page 4 has no readable text/);
    expect(docket.refusals.map((refusal) => refusal.explanation).join(" ")).not.toMatch(/Page 1 of 8/);
    expect(docket.refusals.map((refusal) => refusal.explanation).join(" ")).not.toMatch(/Kowhai/);
  }, 60000);
});