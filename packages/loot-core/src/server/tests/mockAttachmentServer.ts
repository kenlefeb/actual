// A sync server's attachment endpoints, for tests that mock
// `#platform/server/fetch`. Holds documents in memory.
type Refusal = { status: number; body: Record<string, unknown> };

export const attachmentServer = {
  blobs: new Map<string, Uint8Array>(),
  uploads: [] as Array<{ id: string; encrypted: boolean }>,
  deletes: [] as string[],
  fileSizeLimitMB: 10,
  offline: false,
  // Refuses the nth upload from now (1-based), once
  refuseUploadNumber: null as number | null,
  refusal: null as Refusal | null,
  // Runs after a document is stored, before the response
  onStored: null as (() => void) | null,

  reset() {
    this.blobs.clear();
    this.uploads = [];
    this.deletes = [];
    this.fileSizeLimitMB = 10;
    this.offline = false;
    this.refuseUploadNumber = null;
    this.refusal = null;
    this.onStored = null;
  },

  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (attachmentServer.offline) {
      throw new TypeError('Failed to fetch');
    }
    const headers = new Headers(init.headers);
    const id = headers.get('x-actual-attachment-id') ?? '';
    const path = new URL(url).pathname;

    switch (path) {
      case '/info':
        return Response.json({
          build: { version: 'test' },
          attachments: { fileSizeLimitMB: attachmentServer.fileSizeLimitMB },
        });
      case '/sync/upload-attachment': {
        const uploadNumber = attachmentServer.uploads.length + 1;
        attachmentServer.uploads.push({
          id,
          encrypted: headers.get('x-actual-attachment-encrypted') === 'true',
        });
        if (attachmentServer.refusal) {
          const { status, body } = attachmentServer.refusal;
          return Response.json(body, { status });
        }
        if (attachmentServer.refuseUploadNumber === uploadNumber) {
          return Response.json({ status: 'error' }, { status: 500 });
        }
        attachmentServer.blobs.set(id, new Uint8Array(init.body as Uint8Array));
        attachmentServer.onStored?.();
        return Response.json({ status: 'ok' });
      }
      case '/sync/download-attachment': {
        const blob = attachmentServer.blobs.get(id);
        return blob
          ? new Response(new Uint8Array(blob))
          : new Response('attachment-not-found', { status: 404 });
      }
      case '/sync/delete-attachment':
        attachmentServer.deletes.push(id);
        attachmentServer.blobs.delete(id);
        return Response.json({ status: 'ok' });
      default:
        return new Response('not found', { status: 404 });
    }
  },
};
