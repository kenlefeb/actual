import React, { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Text } from '@actual-app/components/text';

import { useTagCSS } from '#hooks/useTagCSS';

type MobileTaggedNotesProps = {
  content: string;
  tag: string;
  separator: string;
  onPress?: (content: string) => void;
};

export function MobileTaggedNotes({
  content,
  tag,
  separator,
  onPress,
}: MobileTaggedNotesProps) {
  const getTagCSS = useTagCSS();
  const { t } = useTranslation();
  const [isPressed, setIsPressed] = useState(false);

  if (!onPress) {
    return (
      <>
        <Text
          className={getTagCSS(tag, { compact: true })}
          data-note-interactive
        >
          {content}
        </Text>
        {separator}
      </>
    );
  }

  // The row around the tag is itself a pressable button: keep every press
  // event from reaching it so a tag tap never opens the transaction
  const stop = (event: SyntheticEvent) => event.stopPropagation();

  return (
    <>
      <Text
        className={getTagCSS(tag, { compact: true })}
        data-note-interactive
        data-pressed={isPressed || undefined}
        role="button"
        tabIndex={0}
        aria-label={t('Filter by {{tag}}', { tag: content })}
        onMouseDown={stop}
        onMouseUp={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        onPointerDown={event => {
          stop(event);
          setIsPressed(true);
        }}
        onPointerUp={event => {
          stop(event);
          setIsPressed(false);
        }}
        onPointerLeave={() => setIsPressed(false)}
        onClick={event => {
          stop(event);
          onPress(content);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onPress(content);
          }
        }}
      >
        {content}
      </Text>
      {separator}
    </>
  );
}
