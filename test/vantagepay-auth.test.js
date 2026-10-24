import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../vantagepay-auth.html', import.meta.url), 'utf8');

test('VantagePay auth page includes account access modes', () => {
  for (const mode of ['login', 'signup', 'reset', 'recovery']) {
    assert.ok(html.includes("data-mode=\"" + mode + "\"") || html.includes("mode:'" + mode + "'"), 'missing auth mode: ' + mode);
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
  const open = html.indexOf('<script>', html.indexOf('src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"'));
  assert.ok(open >= 0, 'auth inline script must exist');
  const start = open + '<script>'.length;
  const end = html.indexOf('</script>', start);
  assert.ok(end > start, 'auth inline script must be closed');
  assert.doesNotThrow(() => new vm.Script(html.slice(start, end)), 'inline script must parse');
  assert.match(html, /Authentication library did not load/);
  assert.match(html, /emailRedirectTo/);
  assert.match(html, /redirectTo/);
});
