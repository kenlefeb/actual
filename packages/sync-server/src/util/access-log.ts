// Fork-only: one JSON line on stdout per request that touches a budget file.
// Holds who, which file, which route and when; never a token, a body or
// budget content. Registered once in app-sync.ts, fed by requireFileOwner.
import { AsyncLocalStorage } from 'node:async_hooks';

import type { NextFunction, Request, Response } from 'express';

const requestFile = new AsyncLocalStorage<{ fileId?: string }>();

/** Called where file access is decided; marks the current request as budget-touching. */
export function noteFileAccess(fileId: string) {
  const store = requestFile.getStore();
  if (store) store.fileId = fileId;
}

export function accessLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const store: { fileId?: string } = {};
  const route = req.baseUrl + req.path; // no query string
  res.on('finish', () => {
    if (!store.fileId) return;
    process.stdout.write(
      JSON.stringify({
        event: 'file-access',
        time: new Date().toISOString(),
        userId: res.locals.user_id,
        fileId: store.fileId,
        method: req.method,
        route,
        status: res.statusCode,
      }) + '\n',
    );
  });
  requestFile.run(store, next);
}
