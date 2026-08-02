// Rebuild www/ from the web app in the repo root.
//
// The file list is not maintained here: it is parsed out of sw.js, whose SHELL
// array is already the canonical inventory of everything the app needs and is
// enforced by test/assets.test.mjs. A module that ships on the web ships in the
// app bundle, always, with no second list to forget.
//
// sw.js itself is deliberately not copied: the native shell serves from the
// bundle, and a service worker would only add a stale-cache path.

import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'www');

export function shellFiles() {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!block) throw new Error('could not find the SHELL array in sw.js');
  const files = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return files.filter((f) => f !== './');
}

const files = shellFiles();
rmSync(out, { recursive: true, force: true });
for (const file of files) {
  mkdirSync(join(out, dirname(file)), { recursive: true });
  cpSync(join(root, file), join(out, file));
}
console.log(`www/: ${files.length} files copied from SHELL`);
