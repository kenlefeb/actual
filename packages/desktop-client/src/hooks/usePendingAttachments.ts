import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { send } from '@actual-app/core/platform/client/connection';

import { attachErrorMessage } from '#components/transactions/TransactionAttachments';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

export type PendingAttachment = { name: string; data: Uint8Array };

// Most documents one add may hold; bounds memory at about 50 MB (10 MB each)
export const MAX_PENDING_ATTACHMENTS = 5;

// Documents picked for a transaction that isn't saved yet. They stay in memory
// (nothing is uploaded) until `attachTo` runs on the saved transaction's id.
// Platform-neutral: the phone and the desktop add row both use it.
export function usePendingAttachments(initialFiles: PendingAttachment[] = []) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [files, setFiles] = useState(initialFiles);
  // Mirrors `files` so two picks in flight can't both pass the cap
  const heldCount = useRef(initialFiles.length);

  function notify(type: 'message' | 'error', message: string) {
    dispatch(addNotification({ notification: { type, message } }));
  }

  // Checks the file now, by the same rules as a saved transaction, and holds
  // it only if it passes. Offline, the check fails with the connection message.
  async function add(file: PendingAttachment) {
    if (heldCount.current >= MAX_PENDING_ATTACHMENTS) {
      notify(
        'message',
        t('The limit of {{max}} documents has been reached.', {
          max: MAX_PENDING_ATTACHMENTS,
        }),
      );
      return;
    }
    heldCount.current++;
    let result;
    try {
      result = await send('transaction-attachment-check', { data: file.data });
    } catch {
      result = { error: 'upload-failed' as const };
    }
    if ('error' in result) {
      heldCount.current--;
      notify('error', attachErrorMessage(result, t));
      return;
    }
    setFiles(held => [...held, file]);
  }

  function remove(index: number) {
    heldCount.current--;
    setFiles(held => held.filter((_, i) => i !== index));
  }

  function clear() {
    heldCount.current = 0;
    setFiles([]);
  }

  // One batch call (one undo step). A failure never undoes the save; the user
  // gets one message naming the documents that weren't attached.
  async function attachTo(transactionId: string) {
    if (files.length === 0) {
      return;
    }
    let failedNames: string[];
    try {
      const result = await send('transaction-attachments-add-batch', {
        transactionId,
        files,
      });
      failedNames =
        'error' in result && result.error
          ? files.map(f => f.name)
          : result.failed.map(f => f.name);
    } catch {
      failedNames = files.map(f => f.name);
    }
    clear();
    if (failedNames.length > 0) {
      notify(
        'error',
        t(
          "These documents weren't attached: {{names}}. Check your connection to the server and attach them from the transaction.",
          { names: failedNames.join(', ') },
        ),
      );
    }
  }

  return { files, add, remove, clear, attachTo };
}

export type PendingAttachments = ReturnType<typeof usePendingAttachments>;
