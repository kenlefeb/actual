// @ts-strict-ignore
import { Timestamp } from '@actual-app/crdt';

import { isReadOnly } from '#server/read-only';

import { addSyncListener, applyMessages } from './index';
import type { Message } from './index';

function migrateParentIds(_oldValues, newValues) {
  newValues.forEach((items, table) => {
    if (table === 'transactions') {
      const toApply: Message[] = [];

      items.forEach(newValue => {
        if (
          newValue.isChild === 1 &&
          newValue.parent_id == null &&
          newValue.id.includes('/')
        ) {
          const parentId = newValue.id.split('/')[0];

          toApply.push({
            dataset: 'transactions',
            row: newValue.id,
            column: 'parent_id',
            value: parentId,
            timestamp: Timestamp.send(),
          });
        }
      });

      if (toApply.length > 0) {
        void applyMessages(toApply);
      }
    }
  });
}

let _unlisten = null;
export function listen() {
  unlisten();
  // The repair creates messages that the next sync would push
  if (isReadOnly()) {
    return;
  }
  _unlisten = addSyncListener(migrateParentIds);
}

export function unlisten() {
  if (_unlisten) {
    _unlisten();
    _unlisten = null;
  }
}
