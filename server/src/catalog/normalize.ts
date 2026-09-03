/** Catalog name matching: Unicode NFC, trim, collapse whitespace, lowercase. */
export function normalizeCatalogName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}
