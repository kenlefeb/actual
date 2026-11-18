// Fork-only (sc-3611, native-bridge: "Native refusals carry a stable code").
// A refusal native code reacts to starts with a fixed token,
// `[native:<code>]` or `[native:<code>:<detail,...>]`, because an Error's
// own properties do not survive loot-core's `send()` but its message does.
// Native code branches on the token only; the words after it may change.
// The list is the contract in fixtures/native-refusal-codes.json.
export const NATIVE_REFUSAL_CODES = [
  'needs-confirmed-reconciled',
  'undo-changed-since',
  'undo-nothing',
  'no-budget-for-month',
  'invalid-draft',
  'invalid-setting',
  // sc-3602 (native-add-transaction D1)
  'not-found',
  // sc-3602 (D3): the save
  'changed-since',
  'preview-stale',
] as const;

export type NativeRefusalCode = (typeof NATIVE_REFUSAL_CODES)[number];

export function nativeRefusal(
  code: NativeRefusalCode,
  text: string,
  detail: string[] = [],
) {
  const token = detail.length ? `${code}:${detail.join(',')}` : code;
  return new Error(`[native:${token}] ${text}`);
}
