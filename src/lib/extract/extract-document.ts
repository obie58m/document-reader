import { isFigureLabel, hasLetters, isIgnoredLine, joinAtoms, matchRole, normalizeLabel, splitWide, clusterLine, groupLines } from "./lines";
import { readMoney, readQuantity, textContainsToken, toCents } from "./numbers";
import type {
  ColumnRole,
  ExtractionResult,
  LineItem,
  PrintedFigure,
  QuantityKind,
  Refusal,
  SourcedText,
  TextAtom,
} from "./types";
import type { Line } from "./lines";

/**
 * A number leaves this module only when a heading names it and that exact token
 * is still present in the stored source text. Anything missing, unclear, or
 * contradictory is a refusal. One bad row does not drop the others.
 */

type HeaderColumn = {
  role: ColumnRole;
  label: string;
  left: number;
  right: number;
};

type Header = {
  page: number;
  mode: "position" | "whitespace";
  columns: HeaderColumn[];
  headingProblem: string | null;
};

const QUANTITY_ROLES = new Set<ColumnRole>(["quantity", "ordered", "delivered"]);
const ROW_GAP = 72;

function sourced(value: string, page: number, sourceText: string): SourcedText | null {
  if (!value || !sourceText.includes(value)) return null;
  return { value, page, sourceText };
}

function numberEvidence(value: string, cellSource: string, lineText: string): string {
  return textContainsToken(value, lineText) ? lineText : cellSource;
}

function sourcedNumber(value: string, page: number, sourceText: string): SourcedText | null {
  if (!textContainsToken(value, sourceText)) return null;
  return { value, page, sourceText };
}

function pageLines(lines: Line[], page: number): Line[] {
  return lines.filter((line) => line.page === page);
}

function detectHeader(line: Line): Header | null {
  const clusters = clusterLine(line.items);
  if (clusters.length === 0) return null;

  const widePieces = clusters.length === 1 ? splitWide(clusters[0].text) : null;
  const labels = widePieces && widePieces.length >= 2 ? widePieces : clusters.map((cluster) => cluster.text);
  const roles = labels.map((label) => matchRole(label));
  const recognized = roles.filter((role) => role !== "unknown");
  const hasIdentity = roles.some((role) => role === "description" || role === "sku");
  const hasQuantity = roles.some((role) => QUANTITY_ROLES.has(role));
  const shortEnough = labels.every((label) => label.length <= 40);

  if (recognized.length < 2 || !hasIdentity || !hasQuantity || !shortEnough) return null;
  if (recognized.length / roles.length < 0.5) return null;

  const mode: Header["mode"] = widePieces && widePieces.length >= 2 ? "whitespace" : "position";
  const columns = buildColumns(labels, roles, clusters, mode);
  return {
    page: line.page,
    mode,
    columns,
    headingProblem: ambiguousHeadingReason(line.page, columns),
  };
}

function buildColumns(
  labels: string[],
  roles: ColumnRole[],
  clusters: ReturnType<typeof clusterLine>,
  mode: Header["mode"],
): HeaderColumn[] {
  const raw = labels.map((label, index) => {
    const cluster = mode === "position" ? clusters[index] : null;
    return {
      role: roles[index],
      label,
      x: cluster?.x ?? index,
      right: cluster?.right ?? index + 1,
    };
  });

  if (mode === "whitespace") {
    return raw.map((column, index) => ({
      role: column.role,
      label: column.label,
      left: index,
      right: index + 1,
    }));
  }

  const sorted = [...raw].sort((a, b) => a.x - b.x);
  return sorted.map((column, index) => {
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const left = previous ? (previous.right + column.x) / 2 : column.x - 20;
    const right = next ? (column.right + next.x) / 2 : Number.POSITIVE_INFINITY;
    return { role: column.role, label: column.label, left, right };
  });
}

function ambiguousHeadingReason(page: number, columns: HeaderColumn[]): string | null {
  const labelsFor = (role: ColumnRole) =>
    columns.filter((column) => column.role === role).map((column) => column.label);

  const quantityLabels = labelsFor("quantity");
  if (quantityLabels.length > 1) {
    return `Page ${page} has more than one quantity heading (${quoteList(quantityLabels)}), so no quantities were read from that table.`;
  }

  const ordered = labelsFor("ordered");
  const delivered = labelsFor("delivered");
  const quantity = labelsFor("quantity");
  if (ordered.length > 0 && delivered.length > 0 && quantity.length > 0) {
    return `Page ${page} has headings for quantity, ordered, and delivered. It is not clear which number is the quantity, so that table was not read.`;
  }

  if (ordered.length > 1 || delivered.length > 1) {
    return `Page ${page} repeats an ordered or delivered heading, so no quantities were read from that table.`;
  }

  return null;
}

function quoteList(values: string[]): string {
  return values.map((value) => `“${value}”`).join(" and ");
}

type CellMap = Partial<Record<ColumnRole, string>>;

function cellsFor(line: Line, header: Header): { ambiguous: boolean; cells: CellMap } {
  const lineText = joinAtoms(line.items);
  const wideParts = splitWide(lineText);
  const useWhitespace =
    header.mode === "whitespace" ||
    (line.items.length === 1 && wideParts.length === header.columns.length);

  if (useWhitespace) {
    if (wideParts.length !== header.columns.length) {
      return { ambiguous: true, cells: {} };
    }
    const cells: CellMap = {};
    header.columns.forEach((column, index) => {
      if (column.role === "unknown") return;
      cells[column.role] = wideParts[index];
    });
    return { ambiguous: false, cells };
  }

  const grouped: Partial<Record<ColumnRole, TextAtom[]>> = {};
  let ambiguous = false;
  const internalEdges = header.columns
    .slice(1)
    .map((column) => column.left)
    .filter((edge) => Number.isFinite(edge));

  for (const atom of line.items) {
    if (!atom.str.trim()) continue;
    const center = atom.x + atom.width / 2;
    const column = header.columns.find((candidate) => center >= candidate.left && center < candidate.right);
    if (!column) {
      const tableLeft = header.columns[0]?.left ?? 0;
      if (center > tableLeft - 8) ambiguous = true;
      continue;
    }
    if (internalEdges.some((edge) => Math.abs(center - edge) < 4)) {
      ambiguous = true;
    }
    if (column.role === "unknown") continue;
    const bucket = grouped[column.role] ?? [];
    bucket.push(atom);
    grouped[column.role] = bucket;
  }

  const cells: CellMap = {};
  for (const role of Object.keys(grouped) as ColumnRole[]) {
    const text = joinAtoms(grouped[role] ?? []);
    if (text) cells[role] = text;
  }

  return { ambiguous, cells };
}

function descriptionFrom(cells: CellMap): { value: string; sourceText: string } | null {
  const description = cells.description?.trim() ?? "";
  const sku = cells.sku?.trim() ?? "";
  const skuIsLineNumber = /^\d{1,4}$/.test(sku);

  if (hasLetters(description) && hasLetters(sku) && !skuIsLineNumber) {
    return { value: `${sku} ${description}`, sourceText: `${sku} ${description}` };
  }
  if (hasLetters(description)) return { value: description, sourceText: description };
  if (hasLetters(sku) && !skuIsLineNumber) return { value: sku, sourceText: sku };
  return null;
}

function optionalMoney(
  cell: string | undefined,
  page: number,
  field: string,
  description: string,
  refusals: Refusal[],
  lineText: string,
): SourcedText | null {
  if (!cell) return null;
  const read = readMoney(cell);
  if (read.status === "empty") return null;
  if (read.status === "refuse") {
    refusals.push({
      page,
      explanation: `The ${field} for “${description}” on page ${page} was refused: ${read.explanation}. The rest of the row was kept where it was clear.`,
      sourceText: lineText,
    });
    return null;
  }
  return sourcedNumber(read.printed, page, numberEvidence(read.printed, read.sourceText, lineText));
}

function pushItem(
  lineItems: LineItem[],
  refusals: Refusal[],
  item: LineItem,
): void {
  const quantityOk = textContainsToken(item.quantity.value, item.quantity.sourceText);
  const descriptionOk = item.description.sourceText.includes(item.description.value);
  const unitPriceOk = !item.unitPrice || textContainsToken(item.unitPrice.value, item.unitPrice.sourceText);
  const amountOk = !item.amount || textContainsToken(item.amount.value, item.amount.sourceText);
  const unitOk = !item.unit || item.unit.sourceText.includes(item.unit.value);

  if (quantityOk && descriptionOk && unitPriceOk && amountOk && unitOk) {
    lineItems.push(item);
    return;
  }

  refusals.push({
    page: item.quantity.page,
    explanation: `A quantity for “${item.description.value}” could not be tied to the printed text, so it was left out.`,
    sourceText: item.quantity.sourceText || null,
  });
}

function labeledTotal(lineText: string): { label: string; value: string } | null {
  const match = lineText.match(
    /^(total|grand total|subtotal|sub total|gst|g\.s\.t\.?|invoice total|amount due|balance due)\s*:\s*(.+)$/i,
  );
  if (!match) return null;
  const money = readMoney(match[2]);
  if (money.status !== "value" || !textContainsToken(money.printed, lineText)) return null;
  return { label: match[1].replace(/\s+/g, " ").trim(), value: money.printed };
}

function interpretRow(
  line: Line,
  header: Header,
  lineItems: LineItem[],
  printedFigures: PrintedFigure[],
  refusals: Refusal[],
  pending: { value: string; sourceText: string } | null,
): { pending: { value: string; sourceText: string } | null; produced: boolean } {
  const lineText = joinAtoms(line.items);
  if (isIgnoredLine(lineText)) {
    return { pending, produced: false };
  }

  const total = labeledTotal(lineText);
  if (total) {
    printedFigures.push({
      label: total.label,
      value: total.value,
      page: line.page,
      sourceText: lineText,
    });
    return { pending: refusePending(pending, line.page, refusals), produced: true };
  }

  const { ambiguous, cells } = cellsFor(line, header);

  if (ambiguous) {
    refusals.push({
      page: line.page,
      explanation: `A row on page ${line.page} does not sit clearly under the headings, so its numbers were not used.`,
      sourceText: lineText || null,
    });
    return { pending: refusePending(pending, line.page, refusals), produced: true };
  }

  const description = descriptionFrom(cells);
  const figureLabel = description?.value ?? cells.description ?? cells.sku ?? "";
  if (figureLabel && isFigureLabel(figureLabel)) {
    const nextPending = refusePending(pending, line.page, refusals);
    readFigure(line, cells, figureLabel, lineText, printedFigures, refusals);
    return { pending: nextPending, produced: true };
  }

  const quantityCell = cells.quantity;
  const orderedCell = cells.ordered;
  const deliveredCell = cells.delivered;
  const hasQuantitySlot = header.columns.some((column) => QUANTITY_ROLES.has(column.role));
  if (!hasQuantitySlot) return { pending, produced: false };

  const filled = [quantityCell, orderedCell, deliveredCell].some((cell) => cell && cell.trim());
  if (!description && !filled) return { pending, produced: false };

  if (!filled) {
    const wordCount = description?.value.split(/\s+/).length ?? 0;
    if (description && !isIgnoredLine(description.value) && wordCount <= 8) {
      if (pending) refusePending(pending, line.page, refusals);
      return { pending: description, produced: true };
    }
    return { pending, produced: false };
  }

  if (!description && pending) {
    return finishQuantity({
      line,
      header,
      cells,
      description: pending,
      lineText,
      lineItems,
      refusals,
      pending: null,
    });
  }

  if (!description) {
    const printed = quantityCell || orderedCell || deliveredCell || "";
    refusals.push({
      page: line.page,
      explanation: `A quantity of “${printed}” is printed on page ${line.page} with no product description, so it was not turned into a line item.`,
      sourceText: lineText || null,
    });
    return { pending: refusePending(pending, line.page, refusals), produced: true };
  }

  return finishQuantity({
    line,
    header,
    cells,
    description,
    lineText,
    lineItems,
    refusals,
    pending: refusePending(pending, line.page, refusals),
  });
}

function finishQuantity(input: {
  line: Line;
  header: Header;
  cells: CellMap;
  description: { value: string; sourceText: string };
  lineText: string;
  lineItems: LineItem[];
  refusals: Refusal[];
  pending: { value: string; sourceText: string } | null;
}): { pending: { value: string; sourceText: string } | null; produced: boolean } {
  const { line, header, cells, description, lineText, lineItems, refusals, pending } = input;
  const resolved = resolveQuantity(header, cells, line.page, description.value, lineText);
  if (resolved.refusal) {
    refusals.push(resolved.refusal);
    return { pending, produced: true };
  }
  if (!resolved.quantity) return { pending, produced: true };

  const descriptionSource = sourced(
    description.value,
    line.page,
    lineText.includes(description.value) ? lineText : description.sourceText,
  );
  if (!descriptionSource) {
    refusals.push({
      page: line.page,
      explanation: `The description “${description.value}” on page ${line.page} could not be tied to the printed text, so the row was left out.`,
      sourceText: lineText,
    });
    return { pending, produced: true };
  }

  const unit = cells.unit?.trim()
    ? sourced(cells.unit.trim(), line.page, cells.unit.trim())
    : null;

  pushItem(lineItems, refusals, {
    description: descriptionSource,
    quantity: {
      ...resolved.quantity,
      sourceText: numberEvidence(resolved.quantity.value, resolved.quantity.sourceText, lineText),
    },
    unit,
    unitPrice: optionalMoney(cells.unitPrice, line.page, "unit price", description.value, refusals, lineText),
    amount: optionalMoney(cells.amount, line.page, "line amount", description.value, refusals, lineText),
  });
  return { pending, produced: true };
}

function resolveQuantity(
  header: Header,
  cells: CellMap,
  page: number,
  description: string,
  lineText: string,
): { quantity: LineItem["quantity"] | null; refusal: Refusal | null } {
  const roles = new Set(header.columns.map((column) => column.role));

  if (roles.has("ordered") && roles.has("delivered")) {
    return resolveOrderedAndDelivered(cells, page, description, lineText);
  }

  if (roles.has("quantity")) {
    return resolveSingleQuantity(cells.quantity, "quantity", page, description, lineText);
  }
  if (roles.has("ordered")) {
    return resolveSingleQuantity(cells.ordered, "ordered", page, description, lineText);
  }
  if (roles.has("delivered")) {
    return resolveSingleQuantity(cells.delivered, "delivered", page, description, lineText);
  }

  return {
    quantity: null,
    refusal: {
      page,
      explanation: `No quantity heading applied to “${description}” on page ${page}, so no quantity was read.`,
      sourceText: lineText,
    },
  };
}

function resolveOrderedAndDelivered(
  cells: CellMap,
  page: number,
  description: string,
  lineText: string,
): { quantity: LineItem["quantity"] | null; refusal: Refusal | null } {
  const ordered = cells.ordered ? readQuantity(cells.ordered) : { status: "empty" as const };
  const delivered = cells.delivered ? readQuantity(cells.delivered) : { status: "empty" as const };

  if (ordered.status === "refuse" || delivered.status === "refuse") {
    const detail = ordered.status === "refuse" ? ordered.explanation : delivered.status === "refuse" ? delivered.explanation : "";
    return {
      quantity: null,
      refusal: {
        page,
        explanation: `“${description}” on page ${page} was refused: ${detail}.`,
        sourceText: lineText,
      },
    };
  }

  if (ordered.status !== "value" || delivered.status !== "value") {
    const present = ordered.status === "value" ? ordered.printed : delivered.status === "value" ? delivered.printed : null;
    return {
      quantity: null,
      refusal: {
        page,
        explanation: present
          ? `“${description}” on page ${page} prints “${present}” for only one of ordered and delivered. The missing one was not copied across, so no quantity was chosen.`
          : `“${description}” on page ${page} has ordered and delivered columns, but neither contains a usable quantity.`,
        sourceText: lineText,
      },
    };
  }

  if (ordered.printed !== delivered.printed) {
    return {
      quantity: null,
      refusal: {
        page,
        explanation: `“${description}” on page ${page} lists an ordered quantity of “${ordered.printed}” and a delivered quantity of “${delivered.printed}”. They disagree, so neither was used.`,
        sourceText: lineText,
      },
    };
  }

  const value = sourcedNumber(ordered.printed, page, ordered.sourceText);
  if (!value) {
    return {
      quantity: null,
      refusal: {
        page,
        explanation: `“${description}” on page ${page} was refused because the quantity could not be tied to the printed text.`,
        sourceText: lineText,
      },
    };
  }
  return { quantity: { ...value, kind: "quantity" }, refusal: null };
}

function resolveSingleQuantity(
  cell: string | undefined,
  kind: QuantityKind,
  page: number,
  description: string,
  lineText: string,
): { quantity: LineItem["quantity"] | null; refusal: Refusal | null } {
  if (!cell) {
    return {
      quantity: null,
      refusal: {
        page,
        explanation: `No quantity was printed for “${description}” on page ${page}, so none was filled in.`,
        sourceText: lineText,
      },
    };
  }

  const read = readQuantity(cell);
  if (read.status !== "value") {
    return {
      quantity: null,
      refusal: {
        page,
        explanation:
          read.status === "refuse"
            ? `“${description}” on page ${page} was refused: ${read.explanation}.`
            : `No quantity was printed for “${description}” on page ${page}, so none was filled in.`,
        sourceText: lineText,
      },
    };
  }

  const value = sourcedNumber(read.printed, page, read.sourceText);
  if (!value) {
    return {
      quantity: null,
      refusal: {
        page,
        explanation: `“${description}” on page ${page} was refused because the quantity could not be tied to the printed text.`,
        sourceText: lineText,
      },
    };
  }
  return { quantity: { ...value, kind }, refusal: null };
}

function readFigure(
  line: Line,
  cells: CellMap,
  label: string,
  lineText: string,
  printedFigures: PrintedFigure[],
  refusals: Refusal[],
): void {
  const amountCell = cells.amount ?? cells.unitPrice;
  if (!amountCell) {
    const strayNumbers = tokensFromCells(cells);
    if (strayNumbers.length === 1) {
      refusals.push({
        page: line.page,
        explanation: `“${label}” on page ${line.page} has a number, but it is not in an amount column, so it was not recorded as a total.`,
        sourceText: lineText,
      });
      return;
    }
    if (strayNumbers.length > 1) {
      refusals.push({
        page: line.page,
        explanation: `“${label}” on page ${line.page} has more than one number, so none was chosen as the total.`,
        sourceText: lineText,
      });
    }
    return;
  }

  const read = readMoney(amountCell);
  if (read.status !== "value") {
    refusals.push({
      page: line.page,
      explanation:
        read.status === "refuse"
          ? `“${label}” on page ${line.page} was refused: ${read.explanation}.`
          : `“${label}” on page ${line.page} has no printed amount, so none was filled in.`,
      sourceText: lineText,
    });
    return;
  }

  if (!textContainsToken(read.printed, lineText)) {
    refusals.push({
      page: line.page,
      explanation: `“${label}” on page ${line.page} could not be tied to the printed text, so it was left out.`,
      sourceText: lineText,
    });
    return;
  }

  printedFigures.push({
    label: label.replace(/\s+/g, " ").trim(),
    value: read.printed,
    page: line.page,
    sourceText: lineText,
  });
}

function tokensFromCells(cells: CellMap): string[] {
  return Object.values(cells).flatMap((cell) => (cell ? [...cell.matchAll(/-?\d[\d,.]*/g)].map((match) => match[0]) : []));
}

function refusePending(
  pending: { value: string; sourceText: string } | null,
  page: number,
  refusals: Refusal[],
): null {
  if (!pending || isIgnoredLine(pending.value)) return null;
  refusals.push({
    page,
    explanation: `No quantity was printed for “${pending.value}” on page ${page}, so none was filled in.`,
    sourceText: pending.sourceText,
  });
  return null;
}

function statedCountConflicts(lines: Line[]): Refusal[] {
  const hits: Array<{ count: string; text: string; page: number; kind: "loaded" | "unloaded" }> = [];
  for (const line of lines) {
    const text = joinAtoms(line.items);
    const match = text.match(/\b(\d+)\s+pallets?\s+(loaded|unloaded)\b/i);
    if (!match) continue;
    hits.push({
      count: match[1],
      text,
      page: line.page,
      kind: match[2].toLowerCase() === "loaded" ? "loaded" : "unloaded",
    });
  }

  const loaded = hits.find((hit) => hit.kind === "loaded");
  const unloaded = hits.find((hit) => hit.kind === "unloaded");
  if (!loaded || !unloaded || loaded.count === unloaded.count) return [];

  const where =
    loaded.page === unloaded.page
      ? `On page ${loaded.page}, the document says “${loaded.count}” pallets were loaded and “${unloaded.count}” pallets were unloaded.`
      : `Page ${loaded.page} says “${loaded.count}” pallets were loaded, and page ${unloaded.page} says “${unloaded.count}” pallets were unloaded.`;

  return [
    {
      page: loaded.page,
      explanation: `${where} Those disagree, so neither was used as a quantity.`,
      sourceText: `Page ${loaded.page}: “${loaded.text}”\nPage ${unloaded.page}: “${unloaded.text}”`,
    },
  ];
}

function looseQuantityRefusals(lines: Line[], consumed: Set<Line>): Refusal[] {
  const refusals: Refusal[] = [];
  for (const line of lines) {
    if (consumed.has(line)) continue;
    const text = joinAtoms(line.items);
    if (!/\b(?:qty|quantity)\b/i.test(text)) continue;
    if (!/\d/.test(text)) continue;
    refusals.push({
      page: line.page,
      explanation: `A quantity is mentioned outside a labeled table (“${text}”). It was not turned into a line item, because it is not under a quantity heading.`,
      sourceText: text,
    });
  }
  return refusals;
}

function disagreeingFigures(figures: PrintedFigure[]): Refusal[] {
  const groups = new Map<string, PrintedFigure[]>();
  for (const figure of figures) {
    const key = normalizeLabel(figure.label);
    const group = groups.get(key) ?? [];
    group.push(figure);
    groups.set(key, group);
  }

  const refusals: Refusal[] = [];
  for (const group of groups.values()) {
    const distinct = group.filter(
      (figure, index) => group.findIndex((other) => other.page === figure.page && other.value === figure.value) === index,
    );
    const values = [...new Set(distinct.map((figure) => figure.value))];
    if (values.length < 2) continue;
    const sample = distinct[0];
    refusals.push({
      page: sample.page,
      explanation: `“${sample.label}” is printed as ${distinct.map((figure) => `“${figure.value}” on page ${figure.page}`).join(" and ")}. Those values disagree, so neither was chosen.`,
      sourceText: distinct.map((figure) => figure.sourceText).join(" | "),
    });
  }
  return refusals;
}

const TAX_OR_ADJUSTMENT = /gst|tax|vat|freight|shipping|discount/i;

function noteTotalMismatch(lineItems: LineItem[], figures: PrintedFigure[], refusals: Refusal[]): Refusal | null {
  if (refusals.length > 0) return null;
  if (lineItems.length === 0) return null;
  if (figures.length !== 1) return null;
  if (TAX_OR_ADJUSTMENT.test(figures[0].label)) return null;
  if (!/^(?:total|grand total|invoice total|order total|amount due|balance due)$/i.test(normalizeLabel(figures[0].label))) {
    return null;
  }

  const lineCents: number[] = [];
  for (const item of lineItems) {
    if (!item.amount) return null;
    const cents = toCents(item.amount.value);
    if (cents === null) return null;
    lineCents.push(cents);
  }
  const totalCents = toCents(figures[0].value);
  if (totalCents === null) return null;
  const sum = lineCents.reduce((total, cents) => total + cents, 0);
  if (sum === totalCents) return null;

  return {
    page: figures[0].page,
    explanation: `The printed ${figures[0].label.toLowerCase()} “${figures[0].value}” on page ${figures[0].page} does not match the printed line amounts. No replacement total was created.`,
    sourceText: figures[0].sourceText,
  };
}

export function extractDocument(atoms: TextAtom[], pageCountInput?: number): ExtractionResult {
  const lines = groupLines(atoms);
  const pageCount = pageCountInput ?? lines.reduce((max, line) => Math.max(max, line.page), 0);
  const lineItems: LineItem[] = [];
  const printedFigures: PrintedFigure[] = [];
  const refusals: Refusal[] = [];
  const consumed = new Set<Line>();

  if (lines.length === 0) {
    return {
      pageCount,
      lineItems,
      printedFigures,
      refusals: [
        {
          page: null,
          explanation:
            "No text could be read from this PDF. It may be a scan or a photo. No quantities were guessed.",
          sourceText: null,
        },
      ],
    };
  }

  let carried: Header | null = null;

  for (let page = 1; page <= pageCount; page += 1) {
    const onPage = pageLines(lines, page);
    if (onPage.length === 0) {
      refusals.push({
        page,
        explanation: `Page ${page} has no readable text. It may be a scan. No quantities were guessed from it.`,
        sourceText: null,
      });
      carried = null;
      continue;
    }

    let header: Header | null = null;
    let skippingToxic = false;
    let pending: { value: string; sourceText: string } | null = null;
    let lastY: number | null = null;
    let rowsUnderHeader = 0;
    let sawHeader = false;
    let produced = false;
    const ownHeader = onPage.some((line) => detectHeader(line));
    if (carried && !ownHeader) {
      header = carried;
    }

    for (const line of onPage) {
      if (lastY !== null && lastY - line.y > ROW_GAP && (header === null || rowsUnderHeader > 0 || skippingToxic)) {
        pending = refusePending(pending, page, refusals);
        header = null;
        skippingToxic = false;
        rowsUnderHeader = 0;
      }
      lastY = line.y;

      const found = detectHeader(line);
      if (found) {
        pending = refusePending(pending, page, refusals);
        sawHeader = true;
        consumed.add(line);
        if (found.headingProblem) {
          refusals.push({ page, explanation: found.headingProblem, sourceText: joinAtoms(line.items) });
          header = null;
          skippingToxic = true;
          continue;
        }
        header = found;
        skippingToxic = false;
        rowsUnderHeader = 0;
        continue;
      }

      if (skippingToxic || !header) continue;

      const before = lineItems.length + refusals.length + printedFigures.length;
      const interpreted = interpretRow(line, header, lineItems, printedFigures, refusals, pending);
      pending = interpreted.pending;
      if (interpreted.produced || lineItems.length + refusals.length + printedFigures.length !== before) {
        consumed.add(line);
        produced = true;
        rowsUnderHeader += 1;
      }
    }

    pending = refusePending(pending, page, refusals);

    if (!sawHeader && !produced && !header) {
      refusals.push({
        page,
        explanation: `Page ${page} has no headings such as Description or Qty, so no line items were read from it.`,
        sourceText: null,
      });
      carried = null;
    } else {
      carried = header;
    }
  }

  refusals.push(...disagreeingFigures(printedFigures));
  const mismatch = noteTotalMismatch(lineItems, printedFigures, refusals);
  if (mismatch) refusals.push(mismatch);
  refusals.push(...statedCountConflicts(lines));
  refusals.push(...looseQuantityRefusals(lines, consumed));

  return { pageCount, lineItems, printedFigures, refusals };
}
