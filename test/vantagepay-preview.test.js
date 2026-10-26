import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../vantagepay-dashboard.html', import.meta.url), 'utf8');

test('legacy demo URLs redirect to real account access', () => {
  assert.match(server, /app\.get\('\/vantagepay\/demo',[\s\S]*?res\.redirect\(302, '\/vantagepay\/login'\)/);
  assert.match(server, /app\.get\('\/vantagepay-preview\.html',[\s\S]*?res\.redirect\(302, '\/vantagepay\/login'\)/);
  assert.doesNotMatch(dashboard, /Open demo|vantagepay-preview\.html|dashboard preview/i);
});

test('public demo page is no longer shipped', async () => {
  await assert.rejects(access(new URL('../vantagepay-preview.html', import.meta.url)));
});
