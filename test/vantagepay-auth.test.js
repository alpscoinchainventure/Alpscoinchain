import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../vantagepay-auth.html', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../vantagepay-preview.html', import.meta.url), 'utf8');

test('VantagePay auth page includes account access modes', () => {
  for (const mode of ['login', 'signup', 'reset', 'recovery']) {
    assert.ok(html.includes('data-mode="' + mode + '"') || html.includes("mode:'" + mode + "'"), 'missing auth mode: ' + mode);
  }
  for (const id of ['auth-form', 'email', 'password', 'confirm-password', 'new-password', 'resend', 'signout', 'refresh-profile']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing auth control: ' + id);
  }
});

test('VantagePay auth page calls Supabase auth APIs rather than simulating authentication', () => {
  for (const api of ['createClient', 'signUp(', 'signInWithPassword(', 'resetPasswordForEmail(', 'updateUser(', 'resend(', 'signOut(', 'getUser(']) {
    assert.ok(html.includes(api), 'missing Supabase auth API: ' + api);
  }
  assert.match(html, /sb_publishable_/);
  assert.doesNotMatch(html, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(html, /No real-money operations enabled/);
});

test('inline authentication script parses and is guarded when the SDK is unavailable', () => {
  const sdkTag = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>';
  const sdkIndex = html.indexOf(sdkTag);
  assert.ok(sdkIndex >= 0, 'Supabase SDK script tag must exist');
  const startTag = html.indexOf('<script>', sdkIndex + sdkTag.length);
  assert.ok(startTag >= 0, 'auth inline script must exist after the SDK tag');
  const start = startTag + '<script>'.length;
  const end = html.indexOf('</script>', start);
  assert.ok(end > start, 'auth inline script must be closed');
  assert.doesNotThrow(() => new vm.Script(html.slice(start, end)), 'inline script must parse');
  assert.match(html, /authentication library did not load/i);
  assert.match(html, /emailRedirectTo/);
  assert.match(html, /redirectTo/);
});

test('VantagePay demo links to authentication and clearly labels fictional financial data', () => {
  assert.match(previewHtml, /href="\/vantagepay-auth\.html"/);
  assert.match(previewHtml, /fictional balances/i);
  assert.match(previewHtml, /does not hold funds/i);
  assert.match(previewHtml, /No live financial connection/i);
});
