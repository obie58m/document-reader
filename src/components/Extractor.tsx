"use client";

import { useState } from "react";
import type { ExtractionResult, QuantityKind } from "@/lib/extract/types";
import { trpc } from "@/lib/trpc/client";

const MAX_BYTES = 15 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function quantityLabel(kind: QuantityKind): string {
  if (kind === "ordered") return "Ordered";
  if (kind === "delivered") return "Delivered";
  return "Quantity";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`“${file.name}” could not be encoded for upload.`));
        return;
      }
      const comma = reader.result.indexOf(",");
      resolve(comma >= 0 ? reader.result.slice(comma + 1) : reader.result);
    };
    reader.onerror = () => {
      reject(new Error(`“${file.name}” could not be read on this computer.`));
    };
    reader.readAsDataURL(file);
  });
}

export function Extractor() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const extract = trpc.extract.document.useMutation();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClientMessage(null);
    setResult(null);

    const form = event.currentTarget;
    const input = form.elements.namedItem("pdf");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) {
      setClientMessage("Choose a PDF before reading.");
      return;
    }

    const looksLikePdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!looksLikePdf) {
      setClientMessage(`“${file.name}” is not a PDF. Choose a .pdf file.`);
      return;
    }
    if (file.size === 0) {
      setClientMessage(`“${file.name}” is empty, so there is nothing to read.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setClientMessage(`“${file.name}” is ${formatBytes(file.size)}. Files larger than 15 MB are not read.`);
      return;
    }

    setFileName(file.name);
    try {
      const pdfBase64 = await fileToBase64(file);
      const extracted = await extract.mutateAsync({ fileName: file.name, pdfBase64 });
      setResult(extracted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setClientMessage(message.trim() || `“${file.name}” was not read, and no reason was returned.`);
    }
  }

  const failure = clientMessage;
  const loading = extract.isPending;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-[var(--stamp)]">Insta Quote AI</p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl">Document reader</h1>
        <p className="max-w-2xl text-base leading-7 text-[var(--ink-soft)]">
          Upload an invoice, packing list, or delivery docket. A quantity is shown only when it is printed
          under a heading such as Qty, Ordered, or Delivered, and the page text it came from is shown with it.
          Missing, unclear, or contradictory numbers are refused instead of guessed.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border border-[var(--line)] bg-white p-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-2 text-sm font-medium text-[var(--ink)]">
          PDF
          <input
            name="pdf"
            type="file"
            accept="application/pdf,.pdf"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--ink)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-md bg-[var(--ink)] px-4 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? "Reading…" : "Read document"}
        </button>
      </form>

      {loading && fileName ? (
        <p role="status" className="rounded-lg border border-[var(--line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--ink)]">
          Reading “{fileName}” and checking each quantity against the text on the page.
        </p>
      ) : null}

      {failure ? (
        <div role="alert" className="rounded-lg border border-[var(--stamp)] bg-[var(--stamp-bg)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--stamp)]">The document was not read</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--ink)]">{failure}</p>
        </div>
      ) : null}

      {result ? <Result result={result} fileName={fileName} /> : null}
    </div>
  );
}

function Result({ result, fileName }: { result: ExtractionResult; fileName: string | null }) {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-[var(--ink-soft)]">
        {fileName ? `“${fileName}”` : "This document"}, {result.pageCount}{" "}
        {result.pageCount === 1 ? "page" : "pages"}: {result.lineItems.length}{" "}
        {result.lineItems.length === 1 ? "line item" : "line items"} extracted, {result.refusals.length}{" "}
        {result.refusals.length === 1 ? "needs" : "need"} review.
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-[var(--ink)]">Line items</h2>
        {result.lineItems.length === 0 ? (
          <p className="text-sm leading-6 text-[var(--ink-soft)]">No line item quantity was extracted.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--line)] text-[var(--ink-soft)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Quantity</th>
                  <th className="px-3 py-2 font-medium">Unit</th>
                  <th className="px-3 py-2 font-medium">Unit price</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Where it was printed</th>
                </tr>
              </thead>
              <tbody>
                {result.lineItems.map((item, index) => (
                  <tr key={`${item.description.value}-${item.quantity.value}-${index}`} className="border-b border-[var(--line)] align-top last:border-0">
                    <td className="px-3 py-3">
                      <div>{item.description.value}</div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        Page {item.description.page}: “{item.description.sourceText}”
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="font-medium">{item.quantity.value}</div>
                      <div className="text-xs text-[var(--ink-soft)]">{quantityLabel(item.quantity.kind)}</div>
                    </td>
                    <td className="px-3 py-3">{item.unit?.value ?? "—"}</td>
                    <td className="px-3 py-3">
                      {item.unitPrice ? (
                        <>
                          <div>{item.unitPrice.value}</div>
                          <div className="mt-1 text-xs text-[var(--ink-soft)]">“{item.unitPrice.sourceText}”</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {item.amount ? (
                        <>
                          <div>{item.amount.value}</div>
                          <div className="mt-1 text-xs text-[var(--ink-soft)]">“{item.amount.sourceText}”</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div>Page {item.quantity.page}</div>
                      <div className="mt-1 max-w-xs text-xs leading-5 text-[var(--ink-soft)]">
                        “{item.quantity.sourceText}”
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Refusals">
        <h2 className="text-xl font-semibold text-[var(--ink)]">Refused</h2>
        <p className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
          These are places the reader declined to invent a number. They are not a failed upload.
        </p>
        {result.refusals.length === 0 ? (
          <p className="text-sm text-[var(--ink)]">Nothing on this document was refused.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.refusals.map((refusal, index) => (
              <li key={`${refusal.page}-${index}`} className="rounded-lg border border-[var(--stamp-line)] bg-[var(--stamp-bg)] px-4 py-3">
                <p className="text-sm leading-6 text-[var(--ink)]">{refusal.explanation}</p>
                {refusal.sourceText ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">Printed text: “{refusal.sourceText}”</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-[var(--ink)]">Printed totals</h2>
        <p className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
          These are amounts printed next to a label such as Total or GST. They are copied from the page, not calculated.
        </p>
        {result.printedFigures.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">No labeled total was printed.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {result.printedFigures.map((figure, index) => (
              <li key={`${figure.label}-${figure.value}-${index}`} className="rounded-lg border border-[var(--line)] bg-white px-4 py-3 text-sm">
                <div className="font-medium text-[var(--ink)]">
                  {figure.label}: {figure.value}
                </div>
                <div className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                  Page {figure.page}: “{figure.sourceText}”
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
