// Prices are typed in dollars ("129" or "129.50") and stored as whole cents.
export function parseMoneyToCents(text: string): number | null {
  const value = text.trim().replace(/^\$/, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

export function parseWholeNumber(text: string): number | null {
  const value = text.trim();
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}
