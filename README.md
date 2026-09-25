# Document reader

Upload a PDF invoice, packing list, or delivery docket. The page shows the line items it could trace to the text, and a separate list of the places it refused to invent a number.

An accepted value keeps the page it was printed on and the text it was taken from. The value has to appear in that text as its own number. `50` is not evidence for `500`, and `24` is not evidence for `2400`.

## Run

```bash
npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and choose a PDF.

`npm test` runs the refusal rules against positioned text, plus one small invoice built in the test with pdf-lib. Those tests do not need any PDF sitting next to the repo.

## Stack

TypeScript, Next.js, tRPC, and React. PDF.js reads the text layer and the position of each fragment. The import is the legacy build, `pdfjs-dist/legacy/build/pdf.mjs`. The current build calls `Promise.try`. Node 22 does not have that, and the read never comes back.

React Native, Expo, and Supabase are the rest of the product. This is one uploaded file and a web page, so they are not in here. Nothing is stored after the response.

## What comes back

`extract.document` returns three lists.

`lineItems` has a description and a quantity, and a unit, unit price, or amount when that column was printed. Each field is `{ value, page, sourceText }`. For a number, `sourceText` is the printed row when the value is a whole token in that row.

`printedFigures` are amounts printed beside a label such as Total or GST. They are copied from the page. The lines are not added up and returned as a new total.

`refusals` are sentences, with the page and the printed text. The page shows them under **Refused**. That is a successful read.

A file that is not a PDF, is empty, is larger than 15 MB, or cannot be opened is a failed read. The message on screen is the one the server returned, including the file name.

## How a quantity gets through

Text fragments are grouped into lines by page and vertical position. A table starts on a line that has a product heading and a quantity heading. The headings it knows are Qty, Quantity, Ordered, Delivered, Shipped, and the close variants, next to Description, Product, Item, or a code column. The columns are the gaps between those headings.

A quantity cell has to be a single number in the grouping used on New Zealand and Australian documents, such as `1,250.50`, with an optional unit after it (`kg`, `ea`, `m2`). That same string has to be present in the stored source.

The reader leaves the number out, and says why, when:

- the cell is empty, a dash, or `N/A`
- the cell is a range (`10-12`) or an estimate (`about 8`)
- the quantity is only written in words (`twelve`)
- the cell contains two numbers (`2 x 10`)
- Ordered and Delivered are both printed and they differ, or only one of them is filled in
- the row does not sit clearly under the headings
- the page has no table headings, or no text layer
- the same total label is printed with two different amounts, including on a later page
- the notes give two pallet counts that disagree, such as loaded and unloaded

`Pine 90x45` can still have a quantity of 24. The size stays in the description. A unit price cell that cannot be read leaves the quantity in place when the quantity itself is clear. One bad row leaves the other rows in the result.

A line such as `Total: $10.00` is taken as a printed total before any column is assigned. On some layouts the word Total sits under the Qty heading. Read as a row, that line becomes a refusal about a product called Total, which is the wrong complaint.

When every extracted row has an amount, nothing else was refused, and there is exactly one total-like figure and no GST, freight, or discount figure, the printed line amounts are compared with that figure. If they differ, the refusal quotes the printed total. The sum that was used for the comparison is not written into the JSON.

## The hardest decision

Only a column whose heading names a quantity is allowed to produce one.

On a real docket the last number on a row might be the count, the price, the length, or the line number. Choosing it because it looks like the count is how a wrong number gets into a quote. A page with no Qty, Ordered, or Delivered heading comes back as a refusal, even when a sentence somewhere on the page contains a number. Ordered and Delivered stay as two labeled facts. When they differ, neither is used.

The same rule is why a computed total is never published. If the printed total and the line amounts disagree, the useful result is to say so and to keep the printed figure. A sum I calculated would look like a correction, and it would be a number with no source on the page.

## Where this is less sure

The heading list is fixed. A docket that says Count, No., or Packs, and nothing in the list above, will be refused or skipped.

A few lines are skipped even when they fall under a live header: `Page 1 of 8`, document number and date, notes that start with `Note:`, `Summary:`, or `Driver notes:`, and one supplier name from the documents I built this against. A different banner, worded another way, can still be treated as a row and refused.

There is no OCR. A page whose text layer is empty is refused. I would rather return no quantities from a scan than guess at marks on a picture.

A wrapped description is joined only when the following line is a quantity with no description of its own. A product name split across two lines that each contain other text can be split or refused.

If the PDF stored a whole row as one string, the pieces are split on two or more spaces. A wide gap inside the product name shifts the numbers after it. The row is refused when the piece count no longer matches the headings. If the piece count happens to still match, the row can be wrong.

Rotated text is ignored. `1,250` is read as one thousand two hundred and fifty. `1,25` is refused, because that is not a thousands group.

The total comparison only runs in the narrow case described above. A document that already has another refusal, or that prints GST, can still show a printed total that does not match the lines. That total is shown with its source. The mismatch is not called out.

## Three more days

1. Check the awkward layouts into the test suite as positioned text: a letterhead above a repeated header, a Total line sitting in the quantity column, and two different totals. Those are the ones that were easy to adjust and then break a different case.
2. Render the page and draw the box each accepted number came from, so the evidence is visible on the page and not only as a string.
3. Join wrapped description cells from the column positions. A scanned page would still be refused.

## Where the code lives

- `src/lib/extract` is the rules. The tests call this directly.
- `src/lib/pdf/read-pdf.ts` turns a text layer into fragments with a page and a position.
- `src/server/routers/app.ts` is the tRPC route. A failure keeps the reason from the reader.
- `src/components/Extractor.tsx` is the page. Refused and a failed read are separate.
