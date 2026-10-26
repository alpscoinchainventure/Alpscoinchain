import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateTransactionRequest } from '../lib/vantagepay-api.js';

const html = await readFile(new URL('../vantagepay-auth.html', import.meta.url), 'utf8');
const homeHtml = await readFile(new URL('../vantagepay-home.html', import.meta.url), 'utf8');
const dashboardHtml = await readFile(new URL('../vantagepay-dashboard.html', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const standaloneSchema = await readFile(new URL('../docs/vantagepay-standalone-schema.sql', import.meta.url), 'utf8');
const vantagepayApi = await readFile(new URL('../lib/vantagepay-api.js', import.meta.url), 'utf8');

function inlineScript(source, label) {
  const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const match = scripts.find(([, attrs, body]) => !/\bsrc\s*=/.test(attrs) && body.trim());
  assert.ok(match, label + ': inline script must exist');
  let body = match[2].trim();
  if (/\btype=["']module["']/.test(match[1])) {
    body = body.replace(/^import\s+[^;]+;\s*/, '');
  }
  return body;
}


test('VantagePay is independently branded and preview data is clearly disclosed', () => {
  assert.match(homeHtml, /VantagePay is an independent account and ledger platform in development/i);
  assert.match(homeHtml, /sample data displayed is illustrative and invented/i);
  assert.match(homeHtml, /not a bank/i);
  assert.match(homeHtml, /investment advice or an offer/i);
  assert.doesNotMatch(homeHtml, /AlpsCoinChain Investment Ventures|Alpscoinchainventure/i);
  assert.doesNotMatch(homeHtml, /Vintage Banking/i);
  assert.doesNotMatch(vantagepayApi, /separate AlpsCoinChain Investment Ventures/i);
});

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

test('VantagePay auth page uses Neon Auth APIs rather than simulating authentication', () => {
  for (const api of ['createAuthClient', 'SupabaseAuthAdapter', 'signUp(', 'signInWithPassword(', 'resetPasswordForEmail(', 'updateUser(', 'resend(', 'signOut(', 'getUser(']) {
    assert.ok(html.includes(api), 'missing Neon Auth API: ' + api);
  }
  assert.ok(html.includes("fetch('/api/vantagepay/config'"));
  assert.doesNotMatch(html, /service_role|SUPABASE_SERVICE_ROLE_KEY|supabase-js@2/);
  assert.match(html, /No real-money operations enabled/);
});

test('signup does not send the unsupported callbackURL/emailRedirectTo option', () => {
  const start = html.indexOf('client.signUp(');
  const end = html.indexOf(';', start);
  assert.ok(start >= 0 && end > start, 'signup call must exist');
  const signupCall = html.slice(start, end);
  assert.equal(signupCall.includes('emailRedirectTo'), false);
  assert.equal(signupCall.includes('callbackURL'), false);
});
test('auth and dashboard inline scripts parse', () => {
  assert.doesNotThrow(() => new vm.Script(inlineScript(html, 'auth')), 'auth script must parse');
  assert.doesNotThrow(() => new vm.Script(inlineScript(dashboardHtml, 'dashboard')), 'dashboard script must parse');
  assert.match(html, /Neon authentication library.*could not load/i);
  assert.match(html, /verifyOtp\(/);
  assert.match(html, /requestVerificationCode\(/);
  assert.doesNotMatch(html, /emailRedirectTo/);
  assert.match(html, /redirectTo/);
});

test('signup requires a verification code and does not expose unverified sessions', () => {
  assert.match(html, /Email verification is required/);
  assert.match(html, /id="verify-form"/);
  assert.match(html, /id="verification-code"/);
  assert.match(html, /client\.verifyOtp\(\{email,token,type:'signup'\}\)/);
  assert.match(html, /user\.emailVerified !== true/);
  assert.match(vantagepayApi, /VANTAGEPAY_EMAIL_VERIFICATION_REQUIRED/);
});

test('unverified login automatically requests a fresh verification code', () => {
  assert.match(html, /This account is not verified\. We requested a fresh verification code for /);
  assert.match(html, /await requestVerificationCode\(email\)/);
  assert.match(html, /A fresh verification-code request was accepted for /);
  assert.match(html, /This account must verify its email before sign-in, but the code request failed:/);
  assert.match(html, /we could not request a new code:/);
  assert.match(html, /savePendingVerification\(email\)/);
});

test('email verification screen lets users restart verification at a new email address', () => {
  assert.match(html, /id="change-email-toggle"[^>]*>Update email address/);
  assert.match(html, /id="replacement-email" type="email"/);
  assert.match(html, /id="replacement-password" type="password"/);
  assert.match(html, /id="update-email-submit"[^>]*>Update email &amp; send code/);
  assert.match(html, /client\.signUp\(\{email,password,options:\{data:fullName\?\{full_name:fullName\}:\{\}\}\}\)/);
  assert.match(html, /savePendingVerification\(email\)/);
  assert.match(html, /Verification has been restarted for /);
  assert.match(html, /aria-expanded/);
});

test('OTP verification survives page reload without persisting the OTP itself', () => {
  assert.match(html, /vantagepay\.pending-email-verification\.v1/);
  assert.match(html, /function savePendingVerification\(email\)/);
  assert.match(html, /function readPendingVerification\(\)/);
  assert.match(html, /pendingVerification && mode !== 'recovery'/);
  assert.match(html, /Your email is saved if this page reloads/);
  assert.match(html, /sessionStorage/);
  assert.doesNotMatch(html, /sessionStorage\.setItem\([^,]*verification-code/);
});

test('OTP resend is cooldown-limited and reports the newest-code guidance', () => {
  assert.match(html, /RESEND_COOLDOWN_MS = 45000/);
  assert.match(html, /function startResendCooldown\(\)/);
  assert.match(html, /function restoreResendCooldown\(\)/);
  assert.match(html, /Please wait for the resend timer/);
  assert.match(html, /use the newest code you receive/i);
  assert.match(html, /That code may be incorrect or expired/);
  assert.match(html, /await client\.resend\(\{type:'signup',email\}\)/);
});

test('customer KYC profile is linked to the authenticated VantagePay account', () => {
  assert.match(dashboardHtml, /id="kyc-form"/);
  assert.match(dashboardHtml, /apiRequest\('\/api\/vantagepay\/kyc'/);
  assert.match(dashboardHtml, /Update and resubmit KYC/);
  assert.match(vantagepayApi, /app\.get\('\/api\/vantagepay\/kyc'/);
  assert.match(vantagepayApi, /app\.post\('\/api\/vantagepay\/kyc'/);
  assert.match(standaloneSchema, /CREATE TABLE IF NOT EXISTS public\.vp_customer_kyc/);
  assert.match(standaloneSchema, /FUNCTION public\.vp_submit_kyc_profile/);
  assert.match(standaloneSchema, /FUNCTION public\.vp_admin_review_kyc/);
  assert.match(standaloneSchema, /vp_customer_reads_own_kyc/);
  assert.match(standaloneSchema, /reviewer_user_id UUID REFERENCES neon_auth\."user"\(id\)/);
  assert.match(dashboardHtml, /Secure document collection requires an approved KYC provider/);
});

test('transaction and KYC emails fail safely without credentials and never claim money moved', () => {
  assert.match(vantagepayApi, /VANTAGEPAY_RESEND_API_KEY/);
  assert.match(vantagepayApi, /VANTAGEPAY_EMAIL_FROM/);
  assert.match(vantagepayApi, /https:\/\/api\.resend\.com\/emails/);
  assert.match(vantagepayApi, /emailStatusMessage\(emailStatus\)/);
  assert.match(vantagepayApi, /customer_email: context\.user\.email/);
  assert.match(vantagepayApi, /app\.patch\('\/api\/vantagepay\/admin\/kyc\/:id\/status'/);
  assert.match(standaloneSchema, /ADD COLUMN IF NOT EXISTS customer_email TEXT/);
  assert.match(standaloneSchema, /vp_admin_update_request_status/);
});

test('operations console exposes an audited KYC review queue', () => {
  assert.match(server, /\/vantagepay\/admin/);
  assert.match(vantagepayApi, /app\.get\('\/api\/vantagepay\/admin\/kyc'/);
  assert.match(vantagepayApi, /app\.patch\('\/api\/vantagepay\/admin\/kyc\/:id\/status'/);
  assert.match(standaloneSchema, /kyc_status_changed/);
  assert.match(standaloneSchema, /FUNCTION public\.vp_admin_list_kyc/);
});

test('customer dashboard requires a real session and uses user-scoped read-only queries', () => {
  assert.match(dashboardHtml, /client\.auth\.getUser\(\)/);
  assert.match(dashboardHtml, /\.eq\('user_id',user\.id\)/);
  assert.match(dashboardHtml, /apiRequest\('\/api\/vantagepay\/account'/);
  assert.match(vantagepayApi, /rpc\/vp_ensure_customer_account/);
  assert.match(standaloneSchema, /FUNCTION public\.vp_ensure_customer_account/);
  assert.match(vantagepayApi, /app\.get\('\/api\/vantagepay\/account-activity'/);
  assert.match(vantagepayApi, /rpc\/vp_customer_ledger_snapshot/);
  assert.match(dashboardHtml, /apiRequest\('\/api\/vantagepay\/account-activity'\)/);
  assert.match(dashboardHtml, /function formatLedgerUnits\(units,scale\)/);
  assert.doesNotMatch(dashboardHtml, /client\.from\('vp_ledger_transactions'\)/);
  assert.match(dashboardHtml, /\/api\/vantagepay\/transaction-requests/);
  assert.match(dashboardHtml, /Deposit and withdrawal requests are review-only/i);
  assert.doesNotMatch(dashboardHtml, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  assert.match(server, /app\.get\('\/vantagepay-dashboard\.html'/);
});

test('public demo routes are retired and send visitors to real account access', () => {
  assert.match(server, /app\.get\('\/vantagepay\/demo',[\s\S]*?res\.redirect\(302, '\/vantagepay\/login'\)/);
  assert.match(server, /app\.get\('\/vantagepay-preview\.html',[\s\S]*?res\.redirect\(302, '\/vantagepay\/login'\)/);
  assert.doesNotMatch(dashboardHtml, /vantagepay-preview\.html|Open demo|dashboard preview/i);
});


test('VantagePay standalone schema uses valid dollar-quoted trigger function and beneficiary relationship', () => {
  assert.match(standaloneSchema, /AS \$\$\s+BEGIN[\s\S]*?RETURN NEW;\s+END;\s+\$\$;/);
  assert.match(standaloneSchema, /beneficiary_id UUID REFERENCES public\.vp_beneficiary_accounts\(id\)/);
  assert.match(standaloneSchema, /UNIQUE\(user_id, idempotency_key\)/);
  assert.match(standaloneSchema, /idempotency_key TEXT NOT NULL,/);
  assert.match(vantagepayApi, /beneficiary:vp_beneficiary_accounts\(id,beneficiary_name,bank_name,account_last4,currency_code\)/);
  assert.match(dashboardHtml, /beneficiaryText/);
  assert.match(dashboardHtml, /account_last4/);
});


test('transaction request validation requires safe idempotency keys and positive integer minor units', () => {
  const base = { request_type: 'deposit', amount_minor_units: '1250', currency_code: 'NGN' };
  assert.equal(validateTransactionRequest(base, 'request-key-123').valid, true);
  assert.equal(validateTransactionRequest({ ...base, amount_minor_units: '0' }, 'request-key-123').valid, false);
  assert.equal(validateTransactionRequest({ ...base, amount_minor_units: '1.25' }, 'request-key-123').valid, false);
  assert.equal(validateTransactionRequest(base, 'short').valid, false);
  assert.equal(validateTransactionRequest({ ...base, currency_code: 'ngn' }, 'request-key-123').valid, false);
  assert.equal(validateTransactionRequest({ ...base, customer_note: 'x'.repeat(501) }, 'request-key-123').valid, false);
});

test('withdrawal request validation requires a UUID beneficiary and excludes beneficiary from deposits', () => {
  const key = 'request-key-123';
  const withdrawal = { request_type: 'withdrawal', amount_minor_units: '500', currency_code: 'NGN' };
  assert.equal(validateTransactionRequest(withdrawal, key).valid, false);
  const beneficiaryId = 'a1b2c3d4-e5f6-4789-8123-abcdef123456';
  const valid = validateTransactionRequest({ ...withdrawal, beneficiary_id: beneficiaryId }, key);
  assert.equal(valid.valid, true);
  assert.equal(valid.value.beneficiary_id, beneficiaryId);
  const deposit = validateTransactionRequest({ request_type: 'deposit', amount_minor_units: '500', currency_code: 'NGN', beneficiary_id: beneficiaryId }, key);
  assert.equal(deposit.valid, true);
  assert.equal(Object.hasOwn(deposit.value, 'beneficiary_id'), false);
});

test('transaction request endpoint safely reuses matching idempotency keys and rejects mismatched payloads', () => {
  assert.match(vantagepayApi, /async function findExistingRequest\(\)/);
  assert.match(vantagepayApi, /idempotency_key=eq\.' \+/);
  assert.match(vantagepayApi, /if \(!sameRequest\(existing\)\)/);
  assert.match(vantagepayApi, /success: true, duplicate: true, request: existing/);
  assert.match(vantagepayApi, /A concurrent retry may have inserted the row/);
  assert.match(vantagepayApi, /No money was moved/);
});


test('VantagePay request lifecycle creates customer notifications and supports read acknowledgements', () => {
  assert.match(standaloneSchema, /CREATE TABLE IF NOT EXISTS public\.vp_customer_notifications/);
  assert.match(standaloneSchema, /AFTER INSERT OR UPDATE OF status ON public\.vp_transaction_requests/);
  assert.match(standaloneSchema, /vp_customer_notifications_user_date_idx/);
  assert.match(vantagepayApi, /app\.get\('\/api\/vantagepay\/notifications'/);
  assert.match(vantagepayApi, /app\.patch\('\/api\/vantagepay\/notifications\/:id\/read'/);
  assert.match(vantagepayApi, /rpc\/vp_mark_notification_read/);
  assert.match(standaloneSchema, /FUNCTION public\.vp_mark_notification_read/);
  assert.match(dashboardHtml, /<h2>Notifications<\/h2>/);
  assert.match(dashboardHtml, /loadNotifications\(\)/);
});

test('VantagePay admin operations are server-authorized, audited, and cannot mark a request settled', async () => {
  const adminPage = await readFile(new URL('../vantagepay-admin.html', import.meta.url), 'utf8');
  assert.match(server, /\/vantagepay\/admin/);
  assert.match(vantagepayApi, /async function requireAdmin\(/);
  assert.match(vantagepayApi, /vp_admin_memberships/);
  assert.match(standaloneSchema, /vp_admin_audit_log/);
  assert.match(standaloneSchema, /transaction_request_status_changed/);
  assert.match(standaloneSchema, /CREATE OR REPLACE FUNCTION public\.vp_admin_update_request_status/);
  assert.doesNotMatch(standaloneSchema, /CREATE OR REPLACE FUNCTION public\.vp_admin_adjust_customer_balance/);
  assert.match(vantagepayApi, /rpc\/vp_admin_update_request_status/);
  assert.match(vantagepayApi, /!\['under_review', 'submitted', 'rejected', 'cancelled'\]\.includes\(nextStatus\)/);
  assert.match(adminPage, /Server will check enabled admin membership/);
  assert.match(adminPage, /does not settle payments or directly edit balances/);
  assert.doesNotThrow(() => new vm.Script(inlineScript(adminPage, 'admin')), 'admin console script must parse');
  assert.ok(vantagepayApi.includes("app.post('/api/vantagepay/admin/balance-adjustments'"));
  assert.match(vantagepayApi, /VANTAGEPAY_LEDGER_MODEL_NOT_REVIEWED/);
  assert.match(vantagepayApi, /No balance was changed/);
  assert.match(adminPage, /Balance adjustments disabled/);
  assert.match(adminPage, /VANTAGEPAY_LEDGER_MODEL_NOT_REVIEWED/);
});

test('external rewards from the configured partner are signed, mapped, deduplicated, and not auto-credited', () => {
  assert.match(standaloneSchema, /CREATE TABLE IF NOT EXISTS public\.vp_external_reward_events/);
  assert.match(standaloneSchema, /UNIQUE\(provider_code, source_event_id\)/);
  assert.match(standaloneSchema, /vp_notify_external_reward_received/);
  assert.match(vantagepayApi, /app\.post\('\/api\/vantagepay\/webhooks\/rewards'/);
  assert.match(vantagepayApi, /VANTAGEPAY_REWARD_WEBHOOK_SECRET/);
  assert.match(vantagepayApi, /VANTAGEPAY_REWARD_PROVIDER_CODE/);
  assert.match(vantagepayApi, /No balance has been credited/);
  assert.match(vantagepayApi, /on_conflict=provider_code,source_event_id/);
});


test('client profiles are stored in the standalone VantagePay schema with row ownership policies', async () => {
  const profileMigration = await readFile(new URL('../docs/vantagepay-client-profile-migration.sql', import.meta.url), 'utf8');
  assert.match(profileMigration, /CREATE TABLE IF NOT EXISTS public\.vp_customer_profiles/);
  assert.match(profileMigration, /PRIMARY KEY REFERENCES neon_auth\."user"\(id\)/);
  assert.match(profileMigration, /vp_customer_profile_select_own/);
  assert.match(profileMigration, /vp_customer_profile_insert_own/);
  assert.match(profileMigration, /vp_customer_profile_update_own/);
  assert.match(profileMigration, /auth\.uid\(\)\) = user_id/);
  assert.match(profileMigration, /GRANT SELECT, INSERT, UPDATE ON public\.vp_customer_profiles TO authenticated/);
  assert.match(vantagepayApi, /app\.get\('\/api\/vantagepay\/client-profile'/);
  assert.match(vantagepayApi, /app\.post\('\/api\/vantagepay\/client-profile'/);
  assert.match(vantagepayApi, /VANTAGEPAY_CLIENT_PROFILE_MIGRATION_REQUIRED/);
  assert.match(vantagepayApi, /avatarUrl.length > 2048/);
  assert.match(dashboardHtml, /id="client-profile-form"/);
  assert.match(dashboardHtml, /id="client-avatar"/);
  assert.match(dashboardHtml, /await loadClientProfile\(\)/);
  assert.match(dashboardHtml, /Profile picture HTTPS URL/);
  assert.doesNotMatch(profileMigration, /AlpsCoinChain.*(DATABASE|TABLE|SCHEMA)/i);
});


test('customer ledger snapshot migration is read-only and scoped to the signed-in customer', async () => {
  const ledgerMigration = await readFile(new URL('../docs/vantagepay-customer-ledger-snapshot-v1.sql', import.meta.url), 'utf8');
  assert.match(ledgerMigration, /FUNCTION public\.vp_customer_ledger_snapshot\(\)/);
  assert.match(ledgerMigration, /SECURITY DEFINER/);
  assert.match(ledgerMigration, /auth\.uid\(\)/);
  assert.match(ledgerMigration, /tx\.customer_ref = v_account_ref/);
  assert.match(ledgerMigration, /le\.account_code = 'customer:' \|\| v_user_id::text/);
  assert.match(ledgerMigration, /tx\.status = 'posted'/);
  assert.match(ledgerMigration, /GRANT EXECUTE ON FUNCTION public\.vp_customer_ledger_snapshot\(\) TO authenticated/);
  assert.doesNotMatch(ledgerMigration, /INSERT INTO public\.vp_ledger_transactions|UPDATE public\.vp_ledger_transactions|DELETE FROM public\.vp_ledger_transactions/);
});
