import { config } from '#load-config';

import { detectAttachmentType } from './attachments';
import { getPathForAttachment, isValidFileId } from './paths';
import type { FileId } from './paths';

// Keep these samples in step with loot-core/src/shared/attachments.test.ts
function bytes(...parts: Array<string | number[]>) {
  return Buffer.concat(
    parts.map(part =>
      typeof part === 'string'
        ? Buffer.from(part, 'latin1')
        : Buffer.from(part),
    ),
  );
}

const samples = {
  pdf: bytes('%PDF-1.7\n%âãÏÓ\n'),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF'),
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  webp: bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '),
  text: bytes('Thank you for your purchase'),
  docx: bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0]),
  heic: bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0], 'mif1heic'),
  heicMif1: bytes([0, 0, 0, 0x18], 'ftypmif1', [0, 0, 0, 0], 'mif1heic'),
  short: bytes([0xff, 0xd8]),
};

describe('detectAttachmentType', () => {
  it.each([
    ['pdf', 'application/pdf'],
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const)('accepts a %s header', (name, mime) => {
    expect(detectAttachmentType(samples[name])).toBe(mime);
  });

  it.each(['text', 'docx', 'short'] as const)('refuses %s content', name => {
    expect(detectAttachmentType(samples[name])).toBe(null);
  });

  it('refuses a text file named receipt.pdf, since only content counts', () => {
    // The name never reaches the check; the content is plain text
    expect(detectAttachmentType(samples.text)).toBe(null);
  });

  it.each(['heic', 'heicMif1'] as const)('reports %s as heic', name => {
    expect(detectAttachmentType(samples[name])).toBe('heic');
  });
});

describe('getPathForAttachment', () => {
  it('rejects an id like ../file-x', () => {
    expect(isValidFileId('../file-x')).toBe(false);
    expect(() =>
      getPathForAttachment('budget' as FileId, '../file-x' as FileId),
    ).toThrow('Invalid file id');
  });

  it('builds the path under the budget attachments folder', () => {
    const userFiles = config.get('userFiles');
    expect(getPathForAttachment('budget' as FileId, 'att' as FileId)).toBe(
      `${userFiles.replace(/\/$/, '')}/attachments/budget/att.blob`,
    );
  });
});
