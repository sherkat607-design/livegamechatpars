// Bundle the server (and the shared folder) into dist/index.js.
// npm dependencies stay external and are loaded from node_modules at runtime.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  tsconfig: 'tsconfig.json',
  external: Object.keys(pkg.dependencies ?? {}).flatMap((dep) => [dep, `${dep}/*`]),
  logLevel: 'info',
});
