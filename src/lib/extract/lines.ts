import type { ColumnRole, TextAtom } from "./types";

export type Line = {
  page: number;
  y: number;
  items: TextAtom[];
};

export function dedupeAtoms(atoms: TextAtom[]): TextAtom[] {
  const sorted = [...atoms].sort(
    (a, b) => a.page - b.page || b.y - a.y || a.x - b.x || a.str.localeCompare(b.str),
  );
  const kept: TextAtom[] = [];
  for (const atom of sorted) {
    const previous = kept[kept.length - 1];
    if (
      previous &&
      previous.page === atom.page &&
      previous.str === atom.str &&
      Math.abs(previous.x - atom.x) < 1 &&
      Math.abs(previous.y - atom.y) < 1
    ) {
      continue;
    }
    kept.push(atom);
  }
  return kept;
}

export function groupLines(atoms: TextAtom[]): Line[] {
  const sorted = dedupeAtoms(atoms).filter((atom) => atom.str.trim().length > 0);
  const lines: Line[] = [];

  for (const atom of sorted) {
    const current = lines[lines.length - 1];
    const tolerance = Math.max(
      2,
      Math.min(current?.items[0]?.height ?? atom.height, atom.height) * 0.5,
    );
    if (current && current.page === atom.page && Math.abs(current.y - atom.y) <= tolerance) {
      current.items.push(atom);
      continue;
    }
    lines.push({ page: atom.page, y: atom.y, items: [atom] });
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }
  return lines;
}

export function joinAtoms(atoms: TextAtom[]): string {
  const sorted = [...atoms].sort((a, b) => a.x - b.x);
  let text = "";
  for (let index = 0; index < sorted.length; index += 1) {
    const atom = sorted[index];
    if (index > 0) {
      const previous = sorted[index - 1];
      const gap = atom.x - (previous.x + previous.width);
      const wordGap = Math.max(1.2, previous.height * 0.18);
      if (gap > wordGap) text += " ";
    }
    text += atom.str;
  }
  return text.trim();
}

export type Cluster = {
  text: string;
  x: number;
  right: number;
  atoms: TextAtom[];
};

export function clusterLine(items: TextAtom[]): Cluster[] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const groups: TextAtom[][] = [];
  for (const atom of sorted) {
    const group = groups[groups.length - 1];
    if (!group) {
      groups.push([atom]);
      continue;
    }
    const previous = group[group.length - 1];
    const gap = atom.x - (previous.x + previous.width);
    const threshold = Math.max(16, previous.height * 1.5);
    if (gap > threshold) groups.push([atom]);
    else group.push(atom);
  }

  return groups.map((atoms) => ({
    text: joinAtoms(atoms),
    x: Math.min(...atoms.map((atom) => atom.x)),
    right: Math.max(...atoms.map((atom) => atom.x + atom.width)),
    atoms,
  }));
}

export function splitWide(text: string): string[] {
  return text
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const ROLE_MATCHERS: Array<{ role: ColumnRole; test: (label: string) => boolean }> = [
  {
    role: "ordered",
    test: (label) =>
      /^(?:qty\s+)?ordered$|^order(?:ed)?\s+qty$|^quantity\s+ordered$|^qty\s+ordered$/.test(
        label,
      ),
  },
  {
    role: "delivered",
    test: (label) =>
      /^(?:qty\s+)?(?:delivered|shipped|supplied)$|^qty\s+(?:delivered|shipped)$|^quantity\s+(?:delivered|shipped)$|^deliv\.?$/.test(
        label,
      ),
  },
  {
    role: "quantity",
    test: (label) => /^(?:qty|quantity|q'ty|qnty|quan)$/.test(label),
  },
  {
    role: "description",
    test: (label) =>
      /^(?:description|item description|product|product description|goods|particulars|details|material|materials)$/.test(
        label,
      ),
  },
  {
    role: "sku",
    test: (label) =>
      /^(?:sku|code|item code|product code|stock code|part no|part number|item no|item #|item number|item)$/.test(
        label,
      ),
  },
  { role: "unit", test: (label) => /^(?:unit|uom|u\/m|units)$/.test(label) },
  {
    role: "unitPrice",
    test: (label) => /^(?:unit price|price each|rate|unit cost|price|unit rate)$/.test(label),
  },
  {
    role: "amount",
    test: (label) =>
      /^(?:amount|line total|ext price|extension|total price|total|value|net amount|nett)$/.test(
        label,
      ),
  },
];

export function normalizeLabel(text: string): string {
  return text.replace(/[:：]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function matchRole(text: string): ColumnRole {
  const label = normalizeLabel(text);
  for (const matcher of ROLE_MATCHERS) {
    if (matcher.test(label)) return matcher.role;
  }
  return "unknown";
}

const FIGURE_LABEL =
  /^(?:subtotal|sub total|total|grand total|gst|g\.s\.t|tax|vat|amount due|balance due|freight|shipping|discount|invoice total|order total|amount paid|balance)$/i;

export function isFigureLabel(text: string): boolean {
  return FIGURE_LABEL.test(normalizeLabel(text));
}

export function hasLetters(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

/** Blank rules under a table are not product rows. */
export function isIgnoredLine(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return !trimmed || /^[-–—_\s]+$/.test(trimmed);
}
