import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../vantagepay-preview.html', import.meta.url), 'utf8');

test('VantagePay preview includes all advertised interactive controls', () => {
  for (const id of [
    'demo-credit',
    'demo-withdrawal',
    'demo-reset',
    'download-statement',
    'activity-search',
    'clear-search'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'), `missing control: ${id}`);
  }
  for (const plan of ['Starter', 'Gold', 'Premium', 'Retirement']) {
    assert.match(html, new RegExp('data-plan="' + plan + '"'), `missing plan preview: ${plan}`);
  }
});

test('preview script parses and wires up the visible controls', () => {
  const match = html.match(/<script>\s*([\s\S]*?)<\/script>/i);
  assert.ok(match, 'inline preview script must exist');
  assert.doesNotThrow(() => new vm.Script(match[1]), 'inline script must be valid JavaScript');
  for (const id of ['demo-credit', 'demo-withdrawal', 'demo-reset', 'clear-search']) {
    assert.ok(match[1].includes('getElementById("' + id + '").addEventListener'), `missing click handler: ${id}`);
  }
  assert.ok(match[1].includes('URL.createObjectURL'), 'CSV download should create a local downloadable file');
  assert.ok(match[1].includes('That sample amount exceeds the current fictional demo balance'), 'demo withdrawal must reject amounts above fictional balance');
});

test('preview clearly labels financial controls as simulations', () => {
  assert.match(html, /DEMO ONLY/);
  assert.match(html, /does not hold funds/);
  assert.match(html, /no money moved/);
  assert.match(html, /Do not submit personal, banking, identity, or payment information/);
  assert.match(html, /not an application, subscription, investment, or account change/);
});
