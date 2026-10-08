// Bundles the API into dist/server.js. The workspace packages (@rumbo/*)
// ship TypeScript source, so they are compiled in; the npm dependencies stay
// external and are installed in the image (`pnpm install --prod`).
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const npmDependencies = Object.entries(pkg.dependencies)
  .filter(([, version]) => !String(version).startsWith('workspace:'))
  .map(([name]) => name);

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external: npmDependencies.flatMap((name) => [name, `${name}/*`]),
  logLevel: 'info',
});
