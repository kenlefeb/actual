import type { AttachmentAddResult } from '@actual-app/core/server/attachments/app';
import type { TFunction } from 'i18next';

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
