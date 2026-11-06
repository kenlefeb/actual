import { isAbsolute } from 'node:path';

export async function openExternalUrl(
  value: unknown,
  open: (url: string) => Promise<void>,
): Promise<boolean> {
  if (typeof value !== 'string') {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  await open(url.href);
  return true;
}

const ATTACHMENT_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// A file name for an attached document opened in the OS viewer. The extension
// always comes from the checked type, so a name can't make the OS run it.
export function attachmentFileName(
  name: unknown,
  mime: unknown,
): string | null {
  const extension =
    typeof mime === 'string' ? ATTACHMENT_EXTENSIONS[mime] : undefined;
  if (typeof name !== 'string' || !extension) {
    return null;
  }
  const base = (name.split(/[\\/]/).pop() ?? '')
    // oxlint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  const stem = base.toLowerCase().endsWith(`.${extension}`)
    ? base.slice(0, -extension.length - 1)
    : base;
  return `${stem || 'document'}.${extension}`;
}

export function revealLocalFile(
  value: unknown,
  reveal: (path: string) => void,
  isAbsolutePath: (path: string) => boolean = isAbsolute,
): boolean {
  if (
    typeof value !== 'string' ||
    !isAbsolutePath(value) ||
    value.replace(/\\/g, '/').startsWith('//')
  ) {
    return false;
  }
  reveal(value);
  return true;
}
