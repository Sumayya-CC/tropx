export function centsToDisplay(cents: number, currencyCode = 'CAD'): string {
  if (cents == null || isNaN(cents)) return '';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currencyCode,
  }).format(cents / 100);
}

export function displayToCents(value: string | number): number {
  if (value == null) return 0;
  if (typeof value === 'number') {
    return Math.round(value * 100);
  }
  const parsed = parseFloat(value.replace(/[^0-9.-]+/g, ''));
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}
