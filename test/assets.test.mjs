// The service worker's precache list is written by hand, which is a trap once
// there is a game module per game: a new game that is left out of it plays fine
// online and is missing on a cold offline start. These tests make that failure
// loud at commit time rather than silent on a subway.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const sw = read('sw.js');
const html = read('index.html');

test('the service worker precaches every game module', () => {
  for (const file of readdirSync(new URL('src/games/', root))) {
    if (!file.endsWith('.js')) continue;
    assert.ok(
      sw.includes(`src/games/${file}`),
      `sw.js does not precache src/games/${file} -- add it to SHELL`
    );
  }
});

test('the service worker precaches every top-level source module', () => {
  for (const file of readdirSync(new URL('src/', root))) {
    if (!file.endsWith('.js')) continue;
    assert.ok(sw.includes(`src/${file}`), `sw.js does not precache src/${file}`);
  }
});

test('every element the shell looks up exists in the markup', () => {
  // main.js reads its elements by id at load time, so a renamed id in one file
  // and not the other is a blank screen rather than a caught error.
  const main = read('src/main.js');
  const ids = new Set([...main.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]));

  assert.ok(ids.size > 20, 'expected to find the shell id lookups');
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `index.html has no element with id="${id}"`);
  }
});
