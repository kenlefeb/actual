import path from 'path';

import { peggyLoader } from '@actual-app/vite-plugin-peggy';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  const outDir = path.resolve(__dirname, 'lib-dist/browser');

  return {
    mode,
    base: '/kcab/',
    build: {
      target: 'es2020',
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.resolve(__dirname, 'src/server/main.ts'),
        name: 'backend',
        formats: ['iife'],
        fileName: () =>
          isDev ? 'kcab.worker.dev.js' : `kcab.worker.[hash].js`,
      },
      rolldownOptions: {
        onwarn(warning, warn) {
          // Suppress sourcemap warnings from peggy-loader
          if (
            warning.plugin === 'peggy-loader' &&
            warning.message?.includes('Sourcemap')
          ) {
            return;
          }

          // Use default warning handler for other warnings
          warn(warning);
        },
        output: {
          // Users debug from raw stack traces, so compress and strip
          // whitespace but never mangle identifiers (overrides the
          // mangle: true that `minify: 'oxc'` implies).
          ...(!isDev && {
            minify: {
              compress: true,
              mangle: false,
              codegen: true,
            },
          }),
          chunkFileNames: isDev
            ? '[name].kcab.worker.dev.js'
            : '[id].[name].kcab.worker.[hash].js',
          format: 'iife',
          name: 'backend',
          globals: {
            buffer: 'Buffer',
            'process/browser': 'process',
          },
        },
        external: [],
      },
      sourcemap: true,
      minify: isDev ? false : 'oxc',
    },
    define: {
      'process.env': '{}',
      'process.env.IS_DEV': JSON.stringify(isDev),
      'process.env.PUBLIC_URL': JSON.stringify(process.env.PUBLIC_URL || '/'),
      'process.env.ACTUAL_DATA_DIR': JSON.stringify('/'),
      'process.env.ACTUAL_DOCUMENT_DIR': JSON.stringify('/documents'),
      // Fork (sc-5219, native-durable-writes D10): test hooks are compiled out
      // unless a test build asks for them. Fork CI checks production bundles.
      __FORK_TEST_HOOKS__: JSON.stringify(
        process.env.FORK_TEST_HOOKS === 'true',
      ),
      // The kill tests' control (sc-5219 task 3.4): a commit delay this worker
      // uses when nothing set one at run time. 0 unless a test build asks
      __FORK_TEST_COMMIT_DELAY_MS__: JSON.stringify(
        process.env.FORK_TEST_HOOKS === 'true'
          ? Number(process.env.FORK_TEST_COMMIT_DELAY_MS ?? 0)
          : 0,
      ),
      // The guard flip's Release smoke run (sc-5219): this many ms after the
      // worker starts, the next IndexedDB write fails (a full device when
      // FORK_TEST_FAIL_STORAGE_QUOTA=true), with no code in the app binary.
      // 0 unless a test build asks
      __FORK_TEST_FAIL_STORAGE_AFTER_MS__: JSON.stringify(
        process.env.FORK_TEST_HOOKS === 'true'
          ? Number(process.env.FORK_TEST_FAIL_STORAGE_AFTER_MS ?? 0)
          : 0,
      ),
      // sc-5496: delays the open before the budget is marked open, so a test
      // can show a read made during a slow open ending loaded. 0 unless asked
      __FORK_TEST_SLOW_OPEN_MS__: JSON.stringify(
        process.env.FORK_TEST_HOOKS === 'true'
          ? Number(process.env.FORK_TEST_SLOW_OPEN_MS ?? 0)
          : 0,
      ),
      __FORK_TEST_FAIL_STORAGE_QUOTA__: JSON.stringify(
        process.env.FORK_TEST_HOOKS === 'true' &&
          process.env.FORK_TEST_FAIL_STORAGE_QUOTA === 'true',
      ),
    },
    plugins: [
      peggyLoader(),
      nodePolyfills({
        include: [
          'process',
          'stream',
          'path',
          'timers',
          'util',
          'zlib',
          'fs',
          'assert',
          'buffer',
        ],
        globals: {
          process: true,
          global: true,
        },
      }),
      visualizer({ template: 'raw-data', filename: `${outDir}/stats.json` }),
    ],
    optimizeDeps: {
      include: [
        'buffer',
        'process',
        'assert',
        'path-browserify',
        'stream-browserify',
        'timers-browserify',
        'util',
        'browserify-zlib',
      ],
    },
  };
});
