import { createContext, useContext, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, PropsWithChildren } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgAttachment } from '@actual-app/components/icons/v1';
import { Popover } from '@actual-app/components/popover';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type { AttachmentAddResult } from '@actual-app/core/server/attachments/app';
import { q } from '@actual-app/core/shared/query';
import type { TransactionEntity } from '@actual-app/core/types/models';
import type { TFunction } from 'i18next';

import { useMetadataPref } from '#hooks/useMetadataPref';
import { useQuery } from '#hooks/useQuery';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

export type AttachmentSummary = {
  id: string;
  transaction_id: string;
  name: string;
  mime: string;
};

const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/png,image/webp';

const AttachmentsContext = createContext<Map<string, AttachmentSummary[]>>(
  new Map(),
);

// One live query for the whole register; removed attachments are left out
// by the table's tombstone
export function AttachmentsProvider({ children }: PropsWithChildren) {
  const { data } = useQuery<AttachmentSummary>(
    () =>
      q('transaction_attachments')
        .select(['id', 'transaction_id', 'name', 'mime'])
        .orderBy('name'),
    [],
  );
  const byTransaction = new Map<string, AttachmentSummary[]>();
  for (const attachment of data ?? []) {
    const list = byTransaction.get(attachment.transaction_id) ?? [];
    list.push(attachment);
    byTransaction.set(attachment.transaction_id, list);
  }
  return (
    <AttachmentsContext.Provider value={byTransaction}>
      {children}
    </AttachmentsContext.Provider>
  );
}

// A split line shows its parent's documents
export function attachmentsForTransaction(
  byTransaction: Map<string, AttachmentSummary[]>,
  transaction: Pick<TransactionEntity, 'id' | 'parent_id'>,
) {
  return byTransaction.get(transaction.parent_id ?? transaction.id) ?? [];
}

export function useTransactionAttachments(
  transaction: Pick<TransactionEntity, 'id' | 'parent_id'>,
) {
  return attachmentsForTransaction(useContext(AttachmentsContext), transaction);
}

export function attachErrorMessage(
  result: Extract<AttachmentAddResult, { error: unknown }>,
  t: TFunction,
) {
  switch (result.error) {
    case 'too-large':
      return t(
        "This document is larger than the {{limit}} MB limit, so it wasn't attached.",
        { limit: result.limitMB },
      );
    case 'unsupported-type':
      return t('Only PDF, JPEG, PNG and WebP documents can be attached.');
    case 'heic':
      return t(
        "HEIC images aren't supported yet. Choose the photo from your Photos library, or save it as JPEG or PNG, and attach that.",
      );
    case 'quota':
      return t(
        "This budget's document storage is full, so the document wasn't attached.",
      );
    case 'needs-sync-server':
      return t('Attaching documents needs a sync server.');
    default:
      return t(
        "The document wasn't attached. Check your connection to the server and try again.",
      );
  }
}

// A hidden file picker and the action that opens it for one transaction. With
// `onFile`, the picked file goes there instead (a transaction being added).
export function useAttachDocument(
  onFile?: (file: { name: string; data: Uint8Array }) => void,
) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [cloudFileId] = useMetadataPref('cloudFileId');
  const inputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<string | null>(null);

  function notify(type: 'message' | 'error', message: string) {
    dispatch(addNotification({ notification: { type, message } }));
  }

  function attach(transactionId = '') {
    if (!cloudFileId) {
      notify('message', t('Attaching documents needs a sync server.'));
      return;
    }
    targetRef.current = transactionId;
    inputRef.current?.click();
  }

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Lets the same file be picked again
    event.target.value = '';
    const transactionId = targetRef.current;
    if (!file) {
      return;
    }
    if (onFile) {
      onFile({
        name: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      });
      return;
    }
    if (!transactionId) {
      return;
    }
    const result = await send('transaction-attachment-add', {
      transactionId,
      name: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
    });
    if ('error' in result) {
      notify('error', attachErrorMessage(result, t));
    }
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_TYPES}
      style={{ display: 'none' }}
      onChange={onChange}
    />
  );
  return { attach, fileInput };
}

export function openFailedMessage(t: TFunction) {
  return t("This document can't be loaded right now.");
}

async function openDocument(
  attachment: AttachmentSummary,
  onError: () => void,
) {
  const openInViewer = window.Actual?.openAttachment;
  // Opened before the await so the browser doesn't block it as a pop-up
  const tab = openInViewer ? null : window.open('', '_blank');
  const result = await send('transaction-attachment-open', {
    id: attachment.id,
  });
  if ('error' in result) {
    tab?.close();
    onError();
    return;
  }
  if (openInViewer) {
    // The desktop app denies new windows, so it hands the file to the OS
    await openInViewer(result.name, result.mime, result.data);
    return;
  }
  // shortcut: the object URL lives until this page unloads, which a viewer tab needs
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(result.data)], { type: result.mime }),
  );
  if (tab) {
    tab.location.href = url;
  } else {
    window.open(url, '_blank');
  }
}

type AttachmentsIndicatorProps = {
  attachments: AttachmentSummary[];
  style?: CSSProperties;
};

export function AttachmentsIndicator({
  attachments,
  style,
}: AttachmentsIndicatorProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const triggerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  if (attachments.length === 0) {
    return null;
  }

  function onOpenFailed() {
    dispatch(
      addNotification({
        notification: { type: 'error', message: openFailedMessage(t) },
      }),
    );
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="bare"
        data-testid="attachments-icon"
        aria-label={t('Attached documents')}
        style={style}
        onPress={() => setIsOpen(true)}
      >
        <SvgAttachment style={{ width: 13, height: 13 }} />
      </Button>
      <Popover
        triggerRef={triggerRef}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        placement="bottom start"
        style={{ padding: 8, gap: 4, minWidth: 220 }}
      >
        {attachments.map(attachment => (
          <View
            key={attachment.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Text
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {attachment.name}
            </Text>
            <Button onPress={() => void openDocument(attachment, onOpenFailed)}>
              <Trans>Open</Trans>
            </Button>
            <Button
              onPress={() =>
                void send('transaction-attachment-remove', {
                  id: attachment.id,
                })
              }
            >
              <Trans>Remove</Trans>
            </Button>
          </View>
        ))}
      </Popover>
    </>
  );
}
