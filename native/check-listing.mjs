// Counts every store-listing field against its declared limit.
//
// store-listing.md declares each field as a heading ending in "— N chars max"
// followed by a blockquote holding the exact text (single-line fields stay on
// one long line so the count is honest). This walks those pairs and fails if
// anything is over, so a copy edit can't silently blow a console limit.
//
// Run: node native/check-listing.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const md = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'store-listing.md'),
  'utf8'
);

let failed = false;
const sections = md.split(/^### /m).slice(1);
for (const section of sections) {
  const head = section.slice(0, section.indexOf('\n'));
  const limit = head.match(/— (\d+) chars max/)?.[1];
  if (!limit) continue;

  const quoted = section
    .split('\n')
    .filter((line) => line.startsWith('>'))
    .map((line) => line.replace(/^> ?/, ''))
    .join('\n')
    .trim();
  if (!quoted) continue;

  const name = head.replace(/ —.*$/, '');
  const n = quoted.length;
  const ok = n <= Number(limit);
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${name}: ${n}/${limit}`);
}

process.exit(failed ? 1 : 0);
