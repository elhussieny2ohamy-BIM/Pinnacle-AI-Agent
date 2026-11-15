/**
 * Build recipe for the hub, chosen so the package builds outside the harness
 * monorepo: a plain object config (no config-time `tsdown` import), platform
 * modules external through `deps.neverBundle`, and the CJS factory banner the
 * browser module loader requires.
 *
 * Host output is ESM for Node; client output is the loader artifact. Packs are
 * never bundled â€” they are separate packages the profile installs.
 */

/** Package name used as the module-table id in the client artifact. */
const ID = '@PINNACLE/mcp-hub'

/** Shared build settings. */
const shared = {
  outDir: 'lib',
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: [
      /^@PINNACLE\/pack-/,
      '@deepseek-ai/dsh-typert-protocol',
    ],
  },
  experimentalDecorators: true,
  useDefineForClassFields: false,
}

const host = {
  ...shared,
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outputOptions: { entryFileNames: 'index.js' },
}

const client = {
  ...shared,
  entry: { client: 'src/client/index.ts' },
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  // Every shared browser module stays external; the loader supplies require().
  deps: {
    neverBundle: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-typert-protocol',
      'zod',
      '@tanstack/react-virtual',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-dockkit',
      '@deepseek-ai/dsh-client-locale',
    ],
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [host, client]

