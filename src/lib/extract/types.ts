export type TextAtom = {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SourcedText = {
  value: string;
  page: number;
  sourceText: string;
};

export type QuantityKind = "quantity" | "ordered" | "delivered";

export type LineItem = {
  description: SourcedText;
  quantity: SourcedText & { kind: QuantityKind };
  unit: SourcedText | null;
  unitPrice: SourcedText | null;
  amount: SourcedText | null;
};

export type PrintedFigure = {
  label: string;
  value: string;
  page: number;
  sourceText: string;
};

export type Refusal = {
  page: number | null;
  explanation: string;
  sourceText: string | null;
};

export type ExtractionResult = {
  pageCount: number;
  lineItems: LineItem[];
  printedFigures: PrintedFigure[];
  refusals: Refusal[];
};

export type ColumnRole =
  | "description"
  | "sku"
  | "quantity"
  | "ordered"
  | "delivered"
  | "unit"
  | "unitPrice"
  | "amount"
  | "unknown";
