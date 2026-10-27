// Spreadsheet programs run cells that start with = + - @ as formulas, so a hostile name or address
// could do harm when an export is opened. Prefixing a quote makes them plain text.
export const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const csvLine = (cells: string[]) => cells.map(csvCell).join(",");
