import { useEffect, useState } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import type { Modal as ModalType } from '#modals/modalsSlice';

type TransactionAttachmentViewerModalProps = Extract<
  ModalType,
  { name: 'transaction-attachment-viewer' }
>['options'];

const shareStyle = {
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.buttonNormalText,
  backgroundColor: theme.buttonNormalBackground,
  border: `1px solid ${theme.buttonNormalBorder}`,
  borderRadius: 4,
  textDecoration: 'none',
};

// Shows a document fetched by the phone's Documents section; a new tab can't
// read this page's blob: URLs in an iOS home-screen app
export function TransactionAttachmentViewerModal({
  name,
  mime,
  url,
}: TransactionAttachmentViewerModalProps) {
  const [file, setFile] = useState<File | null>(null);

  // Built ahead of the tap: iOS only shares from a tap with no await before it
  useEffect(() => {
    let isCurrent = true;
    void fetch(url)
      .then(response => response.blob())
      .then(blob => {
        if (isCurrent) {
          setFile(new File([blob], name, { type: mime }));
        }
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [url, name, mime]);

  const canShare = !!file && !!navigator.canShare?.({ files: [file] });

  return (
    <Modal
      name="transaction-attachment-viewer"
      // Revoked on close only; an effect cleanup would also run under StrictMode
      onClose={() => URL.revokeObjectURL(url)}
      containerProps={{
        style: {
          minWidth: '100vw',
          maxWidth: '100vw',
          height: 'var(--visual-viewport-height)',
          maxHeight: 'var(--visual-viewport-height)',
          borderRadius: 0,
        },
      }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={name}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ flex: 1, minHeight: 0, gap: 10 }}>
            {mime === 'application/pdf' ? (
              <>
                <iframe
                  title={name}
                  src={url}
                  style={{ flex: 1, width: '100%', border: 0 }}
                />
                {/* iOS iframes show only page 1 and Android shows none */}
                <Text style={{ textAlign: 'center' }}>
                  <Trans>Use Share or save to see every page.</Trans>
                </Text>
              </>
            ) : (
              <View style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <img
                  src={url}
                  alt={name}
                  style={{ maxWidth: '100%', objectFit: 'contain' }}
                />
              </View>
            )}
            {canShare ? (
              <Button
                style={{ minHeight: 44 }}
                onPress={() =>
                  void navigator.share({ files: [file] }).catch(() => undefined)
                }
              >
                <Trans>Share or save</Trans>
              </Button>
            ) : (
              // Link has no download attribute, which saves the blob by name
              // oxlint-disable-next-line actual/no-anchor-tag
              <a href={url} download={name} style={shareStyle}>
                <Trans>Share or save</Trans>
              </a>
            )}
          </View>
        </>
      )}
    </Modal>
  );
}
