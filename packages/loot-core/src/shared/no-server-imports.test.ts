import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared code runs in the client as well as on the server, so it must not
// reach into `server/`. Tests that need server code live under `server/`.
// (A lint rule would have to repeat the whole no-restricted-imports config
// for this folder, so this test is the guard.)
const sharedDir = fileURLToPath(new URL('.', import.meta.url));
const serverImport = /['"](#server(\/[^'"]*)?|(\.\.\/)+server(\/[^'"]*)?)['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__snapshots__' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('shared', () => {
  it('does not import from #server', () => {
    const offenders = sourceFiles(sharedDir).filter(file =>
      readFileSync(file, 'utf8')
        .split('\n')
        .some(
          line =>
            /^\s*(import|export)\b|\bimport\(|\brequire\(/.test(line) &&
            serverImport.test(line),
        ),
    );

    expect(offenders).toEqual([]);
  });

  it('would catch a server import', () => {
    expect(serverImport.test("import { x } from '#server/rules';")).toBe(true);
    expect(serverImport.test("import { x } from '../server/db';")).toBe(true);
    expect(serverImport.test("import { x } from './months';")).toBe(false);
  });
});
