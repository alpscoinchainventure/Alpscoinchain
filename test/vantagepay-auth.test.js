import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../vantagepay-auth.html', import.meta.url), 'utf8');
const dashboardHtml = await readFile(new URL('../vantagepay-dashboard.html', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../vantagepay-preview.html', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');

function inlineScript(source, label) {
  const sdkTag = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>';
  const sdkIndex = source.indexOf(sdkTag);
  assert.ok(sdkIndex >= 0, label + ': Supabase SDK script tag must exist');
  const startTag = source.indexOf('<script>', sdkIndex + sdkTag.length);
  assert.ok(startTag >= 0, label + ': inline script must exist after the SDK tag');
  const start = startTag + '<script>'.length;
  const end = source.indexOf('</script>', start);
  assert.ok(end > start, label + ': inline script must be closed');
  return source.slice(start, end);
}

test('VantagePay auth page includes account access modes and dashboard link', () => {
  for (const mode of ['login', 'signup', 'reset']) {
    assert.ok(html.includes('data-mode="' + mode + '"'), 'missing visible auth mode: ' + mode);
  }
  assert.match(html, /recovery:\s*\{/);
  assert.match(html, /href="\/vantagepay-dashboard\.html"/);
  for (const id of ['auth-form', 'email', 'password', 'confirm-password', 'new-password', 'resend', 'signout', 'refresh-profile']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing auth control: ' + id);
  }
});

test('VantagePay auth page calls Supabase auth APIs rather than simulating authentication', () => {
  for (const api of ['createClient', 'signUp(', 'signInWithPassword(', 'resetPasswordForEmail(', 'updateUser(', 'resend(', 'signOut(', 'getUser(']) {
    assert.ok(html.includes(api), 'missing Supabase auth API: ' + api);
  }
  assert.match(html, /fetch\('\/api\/vantagepay\/config'/);
  assert.doesNotMatch(html, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(html, /No real-money operations enabled/);
});

test('auth and dashboard inline scripts parse', () => {
  assert.doesNotThrow(() => new vm.Script(inlineScript(html, 'auth')), 'auth script must parse');
  assert.doesNotThrow(() => new vm.Script(inlineScript(dashboardHtml, 'dashboard')), 'dashboard script must parse');
  assert.match(html, /authentication library did not load/i);
  assert.match(html, /emailRedirectTo/);
  assert.match(html, /redirectTo/);
});

test('customer dashboard requires a real session and uses user-scoped read-only queries', () => {
  assert.match(dashboardHtml, /client\.auth\.getUser\(\)/);
  assert.match(dashboardHtml, /\.eq\('user_id',user\.id\)/);
  assert.match(dashboardHtml, /vp_customer_accounts/);
  assert.match(dashboardHtml, /vp_ledger_transactions/);
  assert.match(dashboardHtml, /\/api\/vantagepay\/transaction-requests/);
  assert.match(dashboardHtml, /No balance, deposit, withdrawal, transfer, or payout is enabled/i);
  assert.doesNotMatch(dashboardHtml, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  assert.match(server, /app\.get\('\/vantagepay-dashboard\.html'/);
});

test('VantagePay demo links to authentication and clearly labels fictional financial data', () => {
  assert.match(previewHtml, /href="\/vantagepay-auth\.html"/);
  assert.match(previewHtml, /fictional balances/i);
  assert.match(previewHtml, /does not hold funds/i);
  assert.match(previewHtml, /No live financial connection/i);
});
