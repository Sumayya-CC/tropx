export function normalizeSearchName(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, ' ')     // punctuation -> single spaces
    .trim()
    .replace(/\s+/g, ' ');
}
