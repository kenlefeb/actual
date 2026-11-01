import path from 'path';

import { peggyLoader } from '@actual-app/vite-plugin-peggy';
import { defineConfig } from 'vite';

// Tests run the API from source, the same way packages/api does.
const fromSource = process.env.VITEST
  ? {
      resolve: { conditions: ['api'] },
      ssr: {
        noExternal: true,
        external: ['better-sqlite3'],
        resolve: { conditions: ['api'], mainFields: ['module', 'main'] },
      },
    }
  : // The api stays a runtime dependency (its CJS build carries the engine).
    { ssr: { external: ['@actual-app/api'] } };

export default defineConfig({
  ...fromSource,
  plugins: process.env.VITEST ? [peggyLoader()] : [],
  // Dependencies stay external in the build: the server runs from the workspace install.
  build: {
    ssr: true,
    target: 'node22',
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'mcp.js',
        banner: chunk => (chunk.isEntry ? '#!/usr/bin/env node' : ''),
      },
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
  },
});
