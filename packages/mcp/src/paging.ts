export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const MAX_RESPONSE_BYTES = 100_000;
// Room for the envelope (note, has_more, next_cursor) around the rows.
const ENVELOPE_BYTES = 1_000;

export type PageInput = { limit?: number; cursor?: string };

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const { offset } = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (Number.isInteger(offset) && offset >= 0) return offset;
  } catch {
    // fall through to the fixed error
  }
  throw new Error('Invalid cursor.');
}

/** Normalizes `limit` (default 50, at most 200) and decodes `cursor`. */
export function pageParams({ limit, cursor }: PageInput) {
  return {
    limit: Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    offset: decodeCursor(cursor),
  };
}

/**
 * Builds one page from rows fetched starting at `offset` (fetch `limit + 1`
 * so `has_more` is known). Trailing rows that would push the serialized
 * response past 100 KB are left for the next page.
 */
export function buildPage<T>(
  rows: T[],
  { limit, offset }: { limit: number; offset: number },
) {
  const kept: T[] = [];
  let bytes = ENVELOPE_BYTES;
  for (const row of rows.slice(0, limit)) {
    bytes += Buffer.byteLength(JSON.stringify(row));
    // Always return at least one row so a page can make progress.
    if (bytes > MAX_RESPONSE_BYTES && kept.length > 0) break;
    kept.push(row);
  }
  const hasMore = rows.length > kept.length;
  return {
    items: kept,
    has_more: hasMore,
    next_cursor: hasMore ? encodeCursor(offset + kept.length) : null,
  };
}

/** Pages an in-memory list. */
export function pageList<T>(all: T[], input: PageInput) {
  const p = pageParams(input);
  return buildPage(all.slice(p.offset, p.offset + p.limit + 1), p);
}
