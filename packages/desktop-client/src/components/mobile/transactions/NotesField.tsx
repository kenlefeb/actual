import { useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { SvgNotesPaper } from '@actual-app/components/icons/v2';
import { styles } from '@actual-app/components/styles';
import { View } from '@actual-app/components/view';

import { NoteInsertHashButton } from '#components/autocomplete/NoteInsertHashButton';
import { NoteTagAutocomplete } from '#components/autocomplete/NoteTagAutocomplete';
import { TextareaField } from '#components/mobile/MobileForms';
import { NotesTagFormatter } from '#notes/NotesTagFormatter';

type NotesFieldProps = {
  notes: string | null | undefined;
  disabled: boolean;
  onFocus: () => void;
  onBlur?: () => void;
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onUpdate?: (value: string) => void;
};

// Shows the formatted notes (tappable tags and links) until the user taps
// them, then the Notes textbox, so the notes never appear twice.
export function NotesField({
  notes,
  disabled,
  onFocus,
  onBlur,
  onChange,
  onUpdate,
}: NotesFieldProps) {
  const { t } = useTranslation();
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  function startEditing() {
    if (disabled) return;
    // Render and focus inside the tap so iOS raises the keyboard
    flushSync(() => setIsEditing(true));
    noteRef.current?.focus();
  }

  if (isEditing || !notes) {
    return (
      <>
        <TextareaField
          aria-label={t('Notes')}
          ref={noteRef}
          iconStart={<SvgNotesPaper width={17} height={17} />}
          iconEnd={<NoteInsertHashButton inputRef={noteRef} />}
          placeholder={t('Add a note (optional)')}
          disabled={disabled}
          defaultValue={notes ?? ''}
          onFocus={() => {
            setIsEditing(true);
            onFocus();
          }}
          onBlur={() => {
            setIsEditing(false);
            onBlur?.();
          }}
          onChange={onChange}
          onUpdate={onUpdate}
        />
        <NoteTagAutocomplete inputRef={noteRef} />
      </>
    );
  }

  return (
    <View
      role="group"
      aria-label={t('Notes')}
      aria-disabled={disabled || undefined}
      tabIndex={0}
      style={{
        padding: `8px ${styles.mobileEditingPadding}px`,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
      onClick={(event: MouseEvent) => {
        // A tap on a link or tag is not a request to edit
        if ((event.target as HTMLElement).closest('a, [data-note-interactive]'))
          {return;}
        startEditing();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          startEditing();
        }
      }}
    >
      <NotesTagFormatter notes={notes} />
    </View>
  );
}
