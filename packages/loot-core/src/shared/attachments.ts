// The same check as sync-server/src/util/attachments.ts; the sync server
// doesn't depend on loot-core, so each package keeps its own copy.
export type AttachmentType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

const HEIC_BRANDS = new Set(['heic', 'heix', 'mif1']);

function startsWith(data: Uint8Array, prefix: number[], offset = 0) {
  return (
    data.length >= offset + prefix.length &&
    prefix.every((byte, i) => data[offset + i] === byte)
  );
}

function ascii(text: string) {
  return [...text].map(c => c.charCodeAt(0));
}

function readAscii(data: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...data.subarray(start, end));
}

// Identifies a document by its first bytes, never by its name
export function detectAttachmentType(
  data: Uint8Array,
): AttachmentType | 'heic' | null {
  if (startsWith(data, ascii('%PDF-'))) {
    return 'application/pdf';
  }
  if (startsWith(data, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8)) {
    return 'image/webp';
  }
  if (
    startsWith(data, ascii('ftyp'), 4) &&
    data.length >= 12 &&
    HEIC_BRANDS.has(readAscii(data, 8, 12))
  ) {
    return 'heic';
  }
  return null;
}
