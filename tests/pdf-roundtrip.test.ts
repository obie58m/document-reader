import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { appRouter } from "@/server/routers/app";
import { extractUploadedPdf } from "@/server/extract-upload";

async function invoicePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const draw = (text: string, x: number, y: number) => {
    page.drawText(text, { x, y, size: 12, font });
  };

  draw("Description", 50, 700);
  draw("Qty", 320, 700);
  draw("Amount", 430, 700);
  draw("Pine 90x45", 50, 660);
  draw("24", 320, 660);
  draw("204.00", 430, 660);
  draw("Nails", 50, 630);

  return document.save();
}

describe("uploaded PDFs", () => {
  it("returns a sourced quantity and a plain-language refusal from a real PDF", async () => {
    const bytes = await invoicePdf();
    const result = await extractUploadedPdf({
      fileName: "invoice.pdf",
      pdfBase64: Buffer.from(bytes).toString("base64"),
    });

    expect(result.lineItems.map((item) => item.quantity.value)).toEqual(["24"]);
    expect(result.lineItems[0]?.quantity.page).toBe(1);
    expect(result.lineItems[0]?.quantity.sourceText).toContain("24");
    expect(result.lineItems[0]?.description.value).toContain("Pine");
    expect(result.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/Nails/);
    expect(result.refusals.map((refusal) => refusal.explanation).join(" ")).toMatch(/No quantity was printed/);
  });

  it("keeps the real reason a file was rejected", async () => {
    const caller = appRouter.createCaller({});
    await expect(
      caller.extract.document({
        fileName: "notes.txt",
        pdfBase64: Buffer.from("hello").toString("base64"),
      }),
    ).rejects.toThrow(/notes\.txt: This file is not a PDF/);
  });
});
