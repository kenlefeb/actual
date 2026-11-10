import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgAttachment } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';

import { FieldLabel } from '#components/mobile/MobileForms';
import {
  AttachmentsProvider,
  openFailedMessage,
  useAttachDocument,
  useTransactionAttachments,
} from '#components/transactions/TransactionAttachments';
import type { AttachmentSummary } from '#components/transactions/TransactionAttachments';
import type { PendingAttachments } from '#hooks/usePendingAttachments';
import { useUndo } from '#hooks/useUndo';
import { pushModal } from '#modals/modalsSlice';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

type TransactionAttachmentsSectionProps = {
  // The parent's id for a split, since documents attach to the parent
  transactionId: string;
};

export function TransactionAttachmentsSection(
  props: TransactionAttachmentsSectionProps,
) {
  return (
    <AttachmentsProvider>
      <AttachmentsSectionInner {...props} />
    </AttachmentsProvider>
  );
}

const touchButtonStyle = { minHeight: 44, paddingLeft: 12, paddingRight: 12 };

function AttachmentsSectionInner({
  transactionId,
}: TransactionAttachmentsSectionProps) {
  const { t } = useTranslation();
  const attachments = useTransactionAttachments({ id: transactionId });
  const { attach, fileInput } = useAttachDocument();
  const { showUndoNotification } = useUndo();
  const dispatch = useDispatch();

  async function onRemove(attachment: AttachmentSummary) {
    await send('transaction-attachment-remove', { id: attachment.id });
    showUndoNotification({ message: t('Document removed.') });
  }

  async function onOpen(attachment: AttachmentSummary) {
    const result = await send('transaction-attachment-open', {
      id: attachment.id,
    });
    if ('error' in result) {
      dispatch(
        addNotification({
          notification: { type: 'error', message: openFailedMessage(t) },
        }),
      );
      return;
    }
    const openInViewer = window.Actual?.openAttachment;
    if (openInViewer) {
      // The desktop app's narrow window hands the file to the OS viewer
      await openInViewer(result.name, result.mime, result.data);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(result.data)], { type: result.mime }),
    );
    dispatch(
      pushModal({
        modal: {
          name: 'transaction-attachment-viewer',
          options: { name: result.name, mime: result.mime, url },
        },
      }),
    );
  }

  return (
    <View>
      <FieldLabel title={t('Documents')} />
      <View
        style={{
          gap: 6,
          paddingLeft: styles.mobileEditingPadding,
          paddingRight: styles.mobileEditingPadding,
        }}
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
            <Button
              aria-label={t('Open {{name}}', { name: attachment.name })}
              style={touchButtonStyle}
              onPress={() => void onOpen(attachment)}
            >
              <Trans>Open</Trans>
            </Button>
            <Button
              aria-label={t('Remove {{name}}', { name: attachment.name })}
              style={touchButtonStyle}
              onPress={() => void onRemove(attachment)}
            >
              <Trans>Remove</Trans>
            </Button>
          </View>
        ))}
        <Button
          style={{ ...touchButtonStyle, alignSelf: 'flex-start', gap: 6 }}
          onPress={() => attach(transactionId)}
        >
          <SvgAttachment style={{ width: 13, height: 13 }} />
          <Trans>Attach document</Trans>
        </Button>
        {fileInput}
      </View>
    </View>
  );
}

type PendingAttachmentsSectionProps = {
  // Owned by TransactionEdit, since this section unmounts when the screen closes
  pending: PendingAttachments;
};

// The Documents section of a transaction being added: documents are held on
// the device until the transaction is saved, so there is nothing to open
export function PendingAttachmentsSection({
  pending,
}: PendingAttachmentsSectionProps) {
  const { t } = useTranslation();
  const { attach, fileInput } = useAttachDocument(file => {
    void pending.add(file);
  });

  return (
    <View>
      <FieldLabel title={t('Documents')} />
      <View
        style={{
          gap: 6,
          paddingLeft: styles.mobileEditingPadding,
          paddingRight: styles.mobileEditingPadding,
        }}
      >
        {pending.files.map((file, index) => (
          <View
            // Names can repeat, and the list only ever removes by position
            key={`${index}-${file.name}`}
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
              {file.name}
            </Text>
            <Button
              aria-label={t('Remove {{name}}', { name: file.name })}
              style={touchButtonStyle}
              onPress={() => pending.remove(index)}
            >
              <Trans>Remove</Trans>
            </Button>
          </View>
        ))}
        {pending.checking.map((name, index) => (
          <Text
            key={`${index}-${name}`}
            style={{ color: theme.pageTextSubdued }}
          >
            <Trans>Checking {{ name }}…</Trans>
          </Text>
        ))}
        <Button
          style={{ ...touchButtonStyle, alignSelf: 'flex-start', gap: 6 }}
          isDisabled={pending.isFull}
          onPress={() => attach()}
        >
          <SvgAttachment style={{ width: 13, height: 13 }} />
          <Trans>Attach document</Trans>
        </Button>
        {fileInput}
      </View>
    </View>
  );
}
