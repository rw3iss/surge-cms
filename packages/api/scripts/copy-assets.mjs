// Copy non-JS runtime assets into dist/ so that `node dist` resolves the
// __dirname-relative reads in db/migrator.ts + features/migrations.ts. `tsc`
// only emits .js — these SQL files must be copied alongside.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(pkgRoot, 'src');
const dist = join(pkgRoot, 'dist');

/** [from (relative to src), to (relative to dist)] */
const targets = [
  ['db/schema.sql', 'db/schema.sql'],
  ['db/migrations', 'db/migrations'],
];

for (const [from, to] of targets) {
  const d = join(dist, to);
  mkdirSync(dirname(d), { recursive: true });
  cpSync(join(src, from), d, { recursive: true });
  console.log(`copy-assets: ${from} -> dist/${to}`);
}

// Bundle the first-party plugin catalog into dist/plugins-catalog so the
// marketplace can install it (loader.bundledCatalogDir). Skip vendor
// bundles + runtime junk — the plugin's install() hook fetches those.
const catalogSrc = join(pkgRoot, 'plugins');
if (existsSync(catalogSrc)) {
  const SKIP = new Set(['client', '.data', '.git', '.gitignore', 'node_modules']);
  cpSync(catalogSrc, join(dist, 'plugins-catalog'), {
    recursive: true,
    filter: (s) => {
      const b = basename(s);
      return !SKIP.has(b) && !b.endsWith('.zip');
    },
  });
  console.log('copy-assets: plugins/ -> dist/plugins-catalog (minus vendor bundles)');
}
