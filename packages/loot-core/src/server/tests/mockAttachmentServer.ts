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
  // Refuses every upload from the nth from now (1-based) on
  refuseUploadsFrom: null as number | null,
  refusal: null as Refusal | null,
  // Runs after a document is stored, before the response
  onStored: null as (() => void) | null,
  // What a download of a missing document answers with (404)
  notFoundBody: 'attachment-not-found',
  // Documents whose download answers 500
  failDownloads: new Set<string>(),
  // The ids the server holds removal records for
  records: new Set<string>(),
  // Status /attachment-records answers with instead of the ids
  recordsStatus: null as number | null,
  recordsRequests: [] as Array<{ after: string | null; fileId: string }>,
  reports: [] as Array<{
    fileId: string;
    removed: string[];
    live: string[];
  }>,
  reportStatus: null as number | null,
  // Runs when /attachment-records is asked, before it answers
  onRecords: null as (() => unknown) | null,
  // Answers /attachment-records with this page instead of the ids
  // (nth request from now, 1-based)
  recordsPage: null as
    | ((n: number) => { ids: string[]; after: unknown })
    | null,

  reset() {
    this.blobs.clear();
    this.uploads = [];
    this.deletes = [];
    this.fileSizeLimitMB = 10;
    this.offline = false;
    this.refuseUploadNumber = null;
    this.refuseUploadsFrom = null;
    this.refusal = null;
    this.onStored = null;
    this.notFoundBody = 'attachment-not-found';
    this.failDownloads.clear();
    this.records.clear();
    this.recordsStatus = null;
    this.recordsRequests = [];
    this.reports = [];
    this.reportStatus = null;
    this.onRecords = null;
    this.recordsPage = null;
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
        const { refuseUploadsFrom } = attachmentServer;
        if (
          attachmentServer.refuseUploadNumber === uploadNumber ||
          (refuseUploadsFrom != null && uploadNumber >= refuseUploadsFrom)
        ) {
          return Response.json({ status: 'error' }, { status: 500 });
        }
        attachmentServer.blobs.set(id, new Uint8Array(init.body as Uint8Array));
        attachmentServer.onStored?.();
        return Response.json({ status: 'ok' });
      }
      case '/sync/download-attachment': {
        if (attachmentServer.failDownloads.has(id)) {
          return new Response('error', { status: 500 });
        }
        const blob = attachmentServer.blobs.get(id);
        return blob
          ? new Response(new Uint8Array(blob))
          : new Response(attachmentServer.notFoundBody, { status: 404 });
      }
      case '/sync/delete-attachment':
        attachmentServer.deletes.push(id);
        attachmentServer.blobs.delete(id);
        return Response.json({ status: 'ok' });
      case '/sync/attachment-records': {
        const after = new URL(url).searchParams.get('after');
        attachmentServer.recordsRequests.push({
          after,
          fileId: headers.get('x-actual-file-id') ?? '',
        });
        await attachmentServer.onRecords?.();
        if (attachmentServer.recordsStatus) {
          return new Response('no', { status: attachmentServer.recordsStatus });
        }
        if (attachmentServer.recordsPage) {
          return Response.json({
            status: 'ok',
            data: attachmentServer.recordsPage(
              attachmentServer.recordsRequests.length,
            ),
          });
        }
        const page = [...attachmentServer.records]
          .sort()
          .filter(recorded => after == null || recorded > after)
          .slice(0, 1000);
        return Response.json({
          status: 'ok',
          data: {
            ids: page,
            after: page.length === 1000 ? page[page.length - 1] : null,
          },
        });
      }
      case '/sync/report-attachments': {
        if (attachmentServer.reportStatus) {
          return new Response('no', { status: attachmentServer.reportStatus });
        }
        attachmentServer.reports.push(JSON.parse(init.body as string));
        return Response.json({ status: 'ok' });
      }
      default:
        return new Response('not found', { status: 404 });
    }
  },
};
