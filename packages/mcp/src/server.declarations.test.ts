import { UNDOABLE } from '#tools/write/declarations';

import { createServer } from './server';

describe('An undeclared write tool', () => {
  it('stops the server from starting, naming the tool', () => {
    const scopes = UNDOABLE.write_move_category;
    delete UNDOABLE.write_move_category;
    try {
      expect(() => createServer()).toThrow(
        'write_move_category is not declared undoable or not undoable.',
      );
    } finally {
      UNDOABLE.write_move_category = scopes;
    }
    expect(() => createServer()).not.toThrow();
  });
});
