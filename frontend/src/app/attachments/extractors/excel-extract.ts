/**
 * Lazy spreadsheet text extraction via SheetJS (xlsx). Each sheet is rendered
 * as CSV and labelled, giving the model a readable tabular view. Lazy-imported
 * so it never bloats the worker bundle for other attachment types.
 *
 * Note: parsing happens entirely client-side, on the user's own machine, over a
 * file the user chose. We only read cell values into CSV text — no formulas are
 * evaluated. Keep the dependency current as SheetJS publishes fixes.
 */
export const extractExcelText = async (bytes: Uint8Array): Promise<string> => {
  const xlsx = await import('xlsx');
  const workbook = xlsx.read(bytes, { type: 'array' });

  const sections: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }
    const csv = xlsx.utils.sheet_to_csv(sheet).trim();
    if (csv) {
      sections.push(`# ${sheetName}\n${csv}`);
    }
  }
  return sections.join('\n\n');
};
