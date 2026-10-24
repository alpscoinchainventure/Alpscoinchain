import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../vantagepay-auth.html', import.meta.url), 'utf8');

test('VantagePay auth page includes account access modes', () => {
  for (const mode of ['login', 'signup', 'reset', 'recovery']) {
    assert.match(html, new RegExp("['\\\"]" + mode + "['\\\"]"), 'missing auth mode: ' + mode);
  }
  for (const id of ['auth-form', 'email', 'password', 'confirm-password', 'new-password', 'resend', 'signout', 'refresh-profile']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing auth control: ' + id);
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
  const matches = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/gi)];
  assert.ok(matches.length, 'auth inline script must exist');
  for (const match of matches) assert.doesNotThrow(() => new vm.Script(match[1]), 'inline script must parse');
  assert.match(html, /Authentication library did not load/);
  assert.match(html, /emailRedirectTo/);
  assert.match(html, /redirectTo/);
});
