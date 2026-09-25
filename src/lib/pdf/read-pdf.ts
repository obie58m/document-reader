import { getDocument, InvalidPDFException, PasswordException } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextAtom } from "@/lib/extract/types";

export class PdfReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfReadError";
  }
}

export function describePdfFailure(error: unknown): string {
  if (error instanceof PasswordException || (error instanceof Error && error.name === "PasswordException")) {
    return "This PDF is password-protected, so the pages could not be read.";
  }
  if (error instanceof InvalidPDFException) {
    return `This file could not be opened as a PDF. ${error.message}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/password/i.test(message)) {
    return "This PDF is password-protected, so the pages could not be read.";
  }
  if (/invalid pdf/i.test(message)) {
    return `This file could not be opened as a PDF. ${message}`;
  }
  return `The PDF could not be opened. ${message}`;
}

export async function readPdfAtoms(data: Uint8Array): Promise<{ atoms: TextAtom[]; pageCount: number }> {
  if (data.byteLength === 0) {
    throw new PdfReadError("The file is empty, so there is nothing to read.");
  }

  const header = new TextDecoder().decode(data.subarray(0, Math.min(5, data.byteLength)));
  if (!header.startsWith("%PDF")) {
    throw new PdfReadError("This file is not a PDF. It does not start with a PDF header, so it was not read.");
  }

  const copy = new Uint8Array(data.byteLength);
  copy.set(data);

  try {
    const document = await getDocument({
      data: copy,
      disableFontFace: true,
      isOffscreenCanvasSupported: false,
      verbosity: 0,
    }).promise;

    const atoms: TextAtom[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const transform = item.transform as number[];
        const skewX = Number(transform[1] ?? 0);
        const skewY = Number(transform[2] ?? 0);
        if (Math.abs(skewX) > 0.2 || Math.abs(skewY) > 0.2) continue;
        const x = Number(transform[4] ?? 0);
        const y = Number(transform[5] ?? 0);
        const height = Math.abs(item.height) || Math.abs(Number(transform[3] ?? 0)) || 8;
        const width = item.width > 0 ? item.width : Math.max(4, item.str.length * height * 0.45);
        atoms.push({ page: pageNumber, str: item.str, x, y, width, height });
      }
    }

    const pageCount = document.numPages;
    const destroy = (document as { destroy?: () => Promise<void> }).destroy;
    if (destroy) {
      await destroy.call(document).catch(() => undefined);
    }
    return { atoms, pageCount };
  } catch (error) {
    if (error instanceof PdfReadError) throw error;
    throw new PdfReadError(describePdfFailure(error));
  }
}
