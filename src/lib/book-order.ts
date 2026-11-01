type BookDates = { id: string; data: { updatedAt: string; addedAt: string } };

// Dates are required, validated ISO strings. Preserve the existing order on ties.
export function compareBookUpdates(a: BookDates, b: BookDates): number {
  return b.data.updatedAt.localeCompare(a.data.updatedAt)
    || b.data.addedAt.localeCompare(a.data.addedAt)
    || a.id.localeCompare(b.id, 'en');
}
