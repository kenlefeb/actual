import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { send } from '@actual-app/core/platform/client/connection';

import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';
import { attachErrorMessage } from '#util/attachmentMessages';

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
  // Names of the files being checked, for the pending rows
  const [checking, setChecking] = useState<string[]>([]);
  // Refs mirror state so picks and Save in flight see the latest, not a stale render
  const filesRef = useRef(initialFiles);
  const checksRef = useRef(new Set<Promise<void>>());
  // Held plus being checked: what the cap counts, so two picks can't both pass it
  const slotsRef = useRef(initialFiles.length);
  // Bumped by clear(), so a check that started before it is discarded
  const generationRef = useRef(0);

  function notify(type: 'message' | 'error', message: string) {
    dispatch(addNotification({ notification: { type, message } }));
  }

  function setHeld(next: PendingAttachment[]) {
    filesRef.current = next;
    setFiles(next);
  }

  async function check(file: PendingAttachment, generation: number) {
    let result;
    try {
      result = await send('transaction-attachment-check', { data: file.data });
    } catch {
      result = { error: 'upload-failed' as const };
    }
    if (generation !== generationRef.current) {
      // clear() already reset the slots and the pending rows
      return;
    }
    setChecking(names => {
      const at = names.indexOf(file.name);
      return at < 0 ? names : names.filter((_, i) => i !== at);
    });
    if ('error' in result) {
      slotsRef.current--;
      notify('error', attachErrorMessage(result, t));
      return;
    }
    setHeld([...filesRef.current, file]);
  }

  // Checks the file now, by the same rules as a saved transaction, and holds
  // it only if it passes. Offline, the check fails with the connection message.
  async function add(file: PendingAttachment) {
    if (slotsRef.current >= MAX_PENDING_ATTACHMENTS) {
      notify(
        'message',
        t('The limit of {{max}} documents has been reached.', {
          max: MAX_PENDING_ATTACHMENTS,
        }),
      );
      return;
    }
    slotsRef.current++;
    setChecking(names => [...names, file.name]);
    const running = check(file, generationRef.current);
    checksRef.current.add(running);
    try {
      await running;
    } finally {
      checksRef.current.delete(running);
    }
  }

  function remove(index: number) {
    slotsRef.current--;
    setHeld(filesRef.current.filter((_, i) => i !== index));
  }

  function clear() {
    generationRef.current++;
    slotsRef.current = 0;
    setChecking([]);
    setHeld([]);
  }

  // One batch call (one undo step). Waits for checks still running, so a
  // document picked just before Save isn't dropped. A failure never undoes the
  // save; the user gets one message naming the documents that weren't attached.
  async function attachTo(transactionId: string) {
    await Promise.all([...checksRef.current]);
    const held = filesRef.current;
    if (held.length === 0) {
      return;
    }
    let failedNames: string[];
    try {
      const result = await send('transaction-attachments-add-batch', {
        transactionId,
        files: held,
      });
      failedNames =
        'error' in result && result.error
          ? held.map(f => f.name)
          : result.failed.map(f => f.name);
    } catch {
      failedNames = held.map(f => f.name);
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

  const isFull = files.length + checking.length >= MAX_PENDING_ATTACHMENTS;

  return { files, checking, isFull, add, remove, clear, attachTo };
}

export type PendingAttachments = ReturnType<typeof usePendingAttachments>;
