import { readFileSync } from 'node:fs';

// The package version, so the server reports what was released. package.json
// sits one level above both src/ and the bundled dist/mcp.js.
export const version: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
