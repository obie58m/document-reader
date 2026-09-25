const NUMERIC_TOKEN =
  /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+\.\d+|-?\d+\s*\/\s*\d+|-?\d+/g;

const UNITS = new Set([
  "ea",
  "each",
  "pc",
  "pcs",
  "piece",
  "pieces",
  "kg",
  "g",
  "m",
  "m2",
  "m3",
  "mm",
  "cm",
  "lm",
  "sqm",
  "l",
  "hr",
  "hrs",
  "hour",
  "hours",
  "day",
  "days",
  "box",
  "boxes",
  "bag",
  "bags",
  "pack",
  "packs",
  "pkt",
  "pkts",
  "set",
  "sets",
  "no",
  "nos",
  "length",
  "lengths",
  "sheet",
  "sheets",
  "roll",
  "rolls",
  "tin",
  "tins",
  "pair",
  "pairs",
  "unit",
  "units",
  "item",
  "items",
  "job",
  "lot",
  "lots",
]);

export type CellRead =
  | { status: "value"; printed: string; sourceText: string }
  | { status: "empty" }
  | { status: "refuse"; explanation: string };

function tidy(cell: string): string {
  return cell.replace(/\s+/g, " ").trim();
}

function tokensIn(text: string): string[] {
  return [...text.matchAll(NUMERIC_TOKEN)].map((match) => match[0]);
}

/** True when `value` is its own number in `sourceText`. `50` does not count inside `500` or `50.00`. */
export function textContainsToken(value: string, sourceText: string): boolean {
  if (!value || !sourceText.includes(value)) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![0-9.,])${escaped}(?![0-9.,])`).test(sourceText);
}

function looksLikeThousandsOrDecimal(token: string): boolean {
  if (token.includes("/")) return true;
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token)) return true;
  if (/^-?\d+\.\d+$/.test(token)) return true;
  if (/^-?\d+$/.test(token)) return true;
  return false;
}

export function readQuantity(cell: string): CellRead {
  const sourceText = tidy(cell);
  if (!sourceText) return { status: "empty" };

  if (/^(?:-|—|–)$/.test(sourceText)) {
    return {
      status: "refuse",
      explanation: `the quantity is shown as “${sourceText}”, which is not a number`,
    };
  }

  if (/^(?:n\/a|na|tbc|tba|nil|none|pending)$/i.test(sourceText)) {
    return {
      status: "refuse",
      explanation: `the quantity is shown as “${sourceText}”, which is not a number`,
    };
  }

  if (
    /\b(approx(?:imately)?|about|around|circa|estimated|est\.?)\b|~/i.test(
      sourceText,
    )
  ) {
    return {
      status: "refuse",
      explanation: `the quantity is written as “${sourceText}”, which is approximate, so no single number was used`,
    };
  }

  if (/\d\s*[-–—]\s*\d|\d\s+to\s+\d/i.test(sourceText)) {
    return {
      status: "refuse",
      explanation: `the quantity is written as “${sourceText}”, which is a range, so no single number was used`,
    };
  }

  if (/[$]/.test(sourceText) || /^(?:nz\$|au\$|a\$|nzd|aud|usd)\b/i.test(sourceText)) {
    return {
      status: "refuse",
      explanation: `“${sourceText}” looks like a price in the quantity column, so it was not used as a quantity`,
    };
  }

  const tokens = tokensIn(sourceText).filter(looksLikeThousandsOrDecimal);
  if (tokens.length > 1) {
    return {
      status: "refuse",
      explanation: `the quantity cell contains more than one number (“${sourceText}”), so none was chosen`,
    };
  }

  if (tokens.length === 0) {
    return {
      status: "refuse",
      explanation: `“${sourceText}” is not a printed number, so no quantity was taken from it`,
    };
  }

  const printed = tokens[0];
  if (!sourceText.includes(printed)) {
    return {
      status: "refuse",
      explanation: `“${sourceText}” could not be tied to a printed number`,
    };
  }

  const rest = sourceText.replace(printed, "").replace(/^[\s.]+|[\s.]+$/g, "");
  if (!rest) return { status: "value", printed, sourceText };

  if (UNITS.has(rest.toLowerCase())) {
    return { status: "value", printed, sourceText };
  }

  return {
    status: "refuse",
    explanation: `“${sourceText}” mixes a number with other text, so it was not used as a quantity`,
  };
}

export function readMoney(cell: string): CellRead {
  const sourceText = tidy(cell);
  if (!sourceText || /^(?:-|—|–|n\/a|na)$/i.test(sourceText)) {
    return { status: "empty" };
  }

  const withoutCurrency = sourceText.replace(
    /^(?:NZ\$|AU\$|A\$|\$|NZD|AUD|USD)\s*/i,
    "",
  );
  const tokens = tokensIn(withoutCurrency).filter(looksLikeThousandsOrDecimal);
  if (tokens.length === 0) {
    return {
      status: "refuse",
      explanation: `“${sourceText}” is not a printed amount`,
    };
  }
  if (tokens.length > 1) {
    return {
      status: "refuse",
      explanation: `“${sourceText}” contains more than one number, so none was chosen`,
    };
  }

  const printed = tokens[0];
  if (!sourceText.includes(printed)) {
    return {
      status: "refuse",
      explanation: `“${sourceText}” could not be tied to a printed amount`,
    };
  }

  const rest = withoutCurrency.replace(printed, "").trim();
  const unitSuffix = /^(?:cr|dr|\/[a-z][a-z0-9]*|per\s+[a-z][a-z0-9]*)$/i.test(rest);
  if (rest && !unitSuffix) {
    return {
      status: "refuse",
      explanation: `“${sourceText}” mixes a number with other text, so it was not used`,
    };
  }

  return { status: "value", printed, sourceText };
}

export function parseNzAmount(printed: string): number | null {
  const cleaned = printed.replace(/[$,\s]/g, "").replace(/^(?:NZD|AUD|USD)/i, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function toCents(printed: string): number | null {
  const value = parseNzAmount(printed);
  if (value === null) return null;
  return Math.round(value * 100);
}
