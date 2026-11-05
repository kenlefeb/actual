import * as fs from '#platform/server/fs';
import { createApp } from '#server/app';
import { mutator } from '#server/mutators';
import { undoable } from '#server/undo';
import * as Platform from '#shared/platform';

import { applyAmazonMatches } from './apply';
import { matchAmazonCharges } from './match';
import { parseAmazonOrders } from './parse';
import type {
  AmazonApplyMatch,
  AmazonApplyResult,
  AmazonChargeReview,
} from './types';

export type AmazonOrdersHandlers = {
  'amazon-orders-parse': typeof parseOrders;
  'amazon-orders-apply': typeof applyMatches;
};

// Read in the worker and never stored. On the web build the chosen file was
// copied into the in-memory /uploads, so that copy goes as soon as it's read.
async function readExport(filepath: string): Promise<string> {
  try {
    return await fs.readFile(filepath);
  } finally {
    if (Platform.isBrowser && filepath.startsWith('/uploads/')) {
      await fs.removeFile(filepath).catch(() => undefined);
    }
  }
}

async function parseOrders({
  filepath,
}: {
  filepath: string;
}): Promise<
  { error: { missing: string[] } } | { reviews: AmazonChargeReview[] }
> {
  const parsed = parseAmazonOrders(await readExport(filepath));
  if ('missing' in parsed) {
    return { error: { missing: parsed.missing } };
  }
  return { reviews: await matchAmazonCharges(parsed.charges) };
}

async function applyMatches({
  matches,
}: {
  matches: AmazonApplyMatch[];
}): Promise<AmazonApplyResult> {
  return applyAmazonMatches(matches);
}

export const app = createApp<AmazonOrdersHandlers>();
app.method('amazon-orders-parse', parseOrders);
app.method('amazon-orders-apply', mutator(undoable(applyMatches)));
