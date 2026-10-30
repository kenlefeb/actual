import { useRef } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { useInputRefValue } from './useInputRefValue';

it('inserts a tag into a multiline note through React without dropping line breaks', async () => {
  const note = 'Receipt\nPAPERWORK:synthetic-id';
  const changed = vi.fn();
  function Editor() {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [, setValue] = useInputRefValue(ref);
    return (
      <>
        <textarea
          ref={ref}
          aria-label="Notes"
          defaultValue={note}
          onChange={e => changed(e.currentTarget.value)}
        />
        <button onClick={() => setValue(note + '\n#Alex')}>Insert tag</button>
      </>
    );
  }
  render(<Editor />);
  await userEvent.click(screen.getByRole('button', { name: 'Insert tag' }));
  expect(screen.getByRole('textbox')).toHaveValue(note + '\n#Alex');
  expect(changed).toHaveBeenLastCalledWith(note + '\n#Alex');
});
