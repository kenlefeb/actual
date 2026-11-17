import type { Grant } from './grants';
import { MAX_RESPONSE_BYTES } from './paging';

type Env = Record<string, string | undefined>;

/**
 * Write limits: server settings only the operator sets (design D1). A grant
 * may replace a default for its connection, up to the ceiling.
 */
export type Limits = {
  /** Rows (transactions, categories, ...) one call may change. */
  maxRows: number;
  /** Budget cells (category and month) one call may change. */
  maxCells: number;
  /** Rows one call may delete or close. */
  maxDeleteRows: number;
  rowsCeiling: number;
  cellsCeiling: number;
  deleteCeiling: number;
  /** How much of the audit log's end an undo reads. */
  auditTailBytes: number;
  /** The most one write's attempt line may hold, so one write cannot fill the tail. */
  maxAuditLineBytes: number;
  /** The most a dry run's response may hold; a larger one is refused, never shortened. */
  maxResponseBytes: number;
  responseBytesCeiling: number;
};

export const DEFAULT_LIMITS: Limits = {
  maxRows: 50,
  maxCells: 500,
  maxDeleteRows: 50,
  rowsCeiling: 1000,
  cellsCeiling: 2000,
  deleteCeiling: 1000,
  auditTailBytes: 2 * 1024 * 1024,
  maxAuditLineBytes: 512 * 1024,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  responseBytesCeiling: 1_000_000,
};

// What a cell or a row costs in an audit line, with margin (a cell is about
// 105 bytes in a change and 38 in `applied`). shortcut: a flat row estimate;
// measure a worst-case row if the row ceiling is ever raised past 5,000.
const CELL_BYTES = 150;
const ROW_BYTES = 250;
// One ceiling-size write, its undo and a neighbour must stay in the tail.
const WRITES_IN_TAIL = 4;

function count(env: Env, name: string, fallback: number) {
  const value = env[name];
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive whole number.`);
  }
  return Number(value);
}

/**
 * Reads the limits from `<prefix>MAX_ROWS` and the like (stdio uses
 * `ACTUAL_MCP_WRITES_`, the hosted entry `ACTUAL_MCP_`). Throws, with fixed
 * text, on a bad value, a limit above its ceiling, or ceilings the audit tail
 * cannot hold.
 */
export function loadLimits(env: Env, prefix: string): Limits {
  const name = (suffix: string) => `${prefix}${suffix}`;
  const read = (suffix: string, fallback: number) =>
    count(env, name(suffix), fallback);
  const limits: Limits = {
    maxRows: read('MAX_ROWS', DEFAULT_LIMITS.maxRows),
    maxCells: read('MAX_CELLS', DEFAULT_LIMITS.maxCells),
    maxDeleteRows: read('MAX_DELETE_ROWS', DEFAULT_LIMITS.maxDeleteRows),
    rowsCeiling: read('MAX_ROWS_CEILING', DEFAULT_LIMITS.rowsCeiling),
    cellsCeiling: read('MAX_CELLS_CEILING', DEFAULT_LIMITS.cellsCeiling),
    deleteCeiling: read(
      'MAX_DELETE_ROWS_CEILING',
      DEFAULT_LIMITS.deleteCeiling,
    ),
    auditTailBytes: read('AUDIT_TAIL_BYTES', DEFAULT_LIMITS.auditTailBytes),
    maxAuditLineBytes: 0,
    maxResponseBytes: read(
      'MAX_RESPONSE_BYTES',
      DEFAULT_LIMITS.maxResponseBytes,
    ),
    responseBytesCeiling: read(
      'MAX_RESPONSE_BYTES_CEILING',
      DEFAULT_LIMITS.responseBytesCeiling,
    ),
  };
  // A quarter of the tail by default, so 4 writes fit
  limits.maxAuditLineBytes = read(
    'MAX_AUDIT_LINE_BYTES',
    Math.floor(limits.auditTailBytes / WRITES_IN_TAIL),
  );
  if (limits.maxAuditLineBytes * WRITES_IN_TAIL > limits.auditTailBytes) {
    throw new Error(
      `${name('MAX_AUDIT_LINE_BYTES')} is too large for ${name('AUDIT_TAIL_BYTES')}: the audit tail must hold ${WRITES_IN_TAIL} such lines.`,
    );
  }
  const pairs = [
    ['MAX_ROWS', limits.maxRows, limits.rowsCeiling],
    ['MAX_CELLS', limits.maxCells, limits.cellsCeiling],
    ['MAX_DELETE_ROWS', limits.maxDeleteRows, limits.deleteCeiling],
    [
      'MAX_RESPONSE_BYTES',
      limits.maxResponseBytes,
      limits.responseBytesCeiling,
    ],
  ] as const;
  for (const [suffix, limit, ceiling] of pairs) {
    if (limit > ceiling) {
      throw new Error(`${name(suffix)} is above ${name(`${suffix}_CEILING`)}.`);
    }
  }
  const tail = (ceiling: string, bytes: number, ceilingValue: number) => {
    if (WRITES_IN_TAIL * ceilingValue * bytes > limits.auditTailBytes) {
      throw new Error(
        `${name(ceiling)} is too large for ${name('AUDIT_TAIL_BYTES')}: the audit tail must hold ${WRITES_IN_TAIL} writes of that size.`,
      );
    }
  };
  tail('MAX_CELLS_CEILING', CELL_BYTES, limits.cellsCeiling);
  tail('MAX_ROWS_CEILING', ROW_BYTES, limits.rowsCeiling);
  tail('MAX_DELETE_ROWS_CEILING', ROW_BYTES, limits.deleteCeiling);
  return limits;
}

/** The row limit in force: the grant's, else the setting. */
export const rowLimit = (grant: Grant, limits: Limits) =>
  grant.max_rows ?? limits.maxRows;

/** The cell limit in force: the grant's, else the setting. */
export const cellLimit = (grant: Grant, limits: Limits) =>
  grant.max_cells ?? limits.maxCells;

/**
 * The delete limit in force: the lower of the delete limit and the row limit,
 * so raising `max_rows` never widens a delete and lowering it still lowers one.
 */
export const deleteLimit = (grant: Grant, limits: Limits) =>
  Math.min(
    grant.max_delete_rows ?? limits.maxDeleteRows,
    rowLimit(grant, limits),
  );
