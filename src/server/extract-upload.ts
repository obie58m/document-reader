import { extractDocument } from "@/lib/extract/extract-document";
import type { ExtractionResult } from "@/lib/extract/types";
import { PdfReadError, readPdfAtoms } from "@/lib/pdf/read-pdf";

const MAX_BYTES = 15 * 1024 * 1024;

export class UploadReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadReadError";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function extractUploadedPdf(input: {
  fileName: string;
  pdfBase64: string;
}): Promise<ExtractionResult> {
  const fileName = input.fileName.trim() || "The file";
  const estimatedBytes = Math.floor((input.pdfBase64.length * 3) / 4);
  if (estimatedBytes > MAX_BYTES) {
    throw new UploadReadError(
      `"${fileName}" is about ${formatBytes(estimatedBytes)}. Files larger than 15 MB are not read.`,
    );
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(input.pdfBase64)) {
    throw new UploadReadError(
      `"${fileName}" was not valid base64, so the PDF could not be reconstructed.`,
    );
  }

  const bytes = Buffer.from(input.pdfBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new UploadReadError(`"${fileName}" is empty, so there is nothing to read.`);
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new UploadReadError(
      `"${fileName}" is ${formatBytes(bytes.byteLength)}. Files larger than 15 MB are not read.`,
    );
  }

  try {
    const { atoms, pageCount } = await readPdfAtoms(bytes);
    return extractDocument(atoms, pageCount);
  } catch (error) {
    if (error instanceof PdfReadError) {
      throw new UploadReadError(`${fileName}: ${error.message}`);
    }
    const detail = error instanceof Error ? error.message : "unknown failure";
    throw new UploadReadError(`${fileName} could not be read. ${detail}`);
  }
}
