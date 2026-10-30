import { randomUUID, createPublicKey, verify as verifySignature } from 'node:crypto';
import { verifyVantagePaySignature } from './vantagepay-webhook.js';
import { validateApySourceEvent, decimalToMinorUnits } from './vantagepay-apy.js';

const CURRENCIES = new Set(['GBP', 'USD', 'EUR']);
const MINOR_UNITS = /^[1-9]\d{0,35}$/;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isVantagePayEmailVerified(user) {
  // Neon Auth's Better Auth session exposes emailVerified as a boolean.
  // Unknown/missing values fail closed: identity alone is not verified email.
  return Boolean(user && user.emailVerified === true);
}

export function validateTransactionRequest(input, idempotencyKey) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, reason: 'Request body must be an object.' };
  }
  if (!['deposit', 'withdrawal'].includes(input.request_type)) {
    return { valid: false, reason: 'request_type must be deposit or withdrawal.' };
  }
  if (typeof input.amount_minor_units !== 'string' || !MINOR_UNITS.test(input.amount_minor_units)) {
    return { valid: false, reason: 'amount_minor_units must be a positive integer string.' };
  }
  if (typeof input.currency_code !== 'string' || !CURRENCIES.has(input.currency_code)) {
    return { valid: false, reason: 'currency_code must be a three-letter uppercase code.' };
  }
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY.test(idempotencyKey)) {
    return { valid: false, reason: 'Supply an Idempotency-Key header with 8–200 safe characters.' };
  }
  if (input.request_type === 'withdrawal' && (typeof input.beneficiary_id !== 'string' || !UUID.test(input.beneficiary_id))) {
    return { valid: false, reason: 'A valid beneficiary_id is required for a withdrawal request.' };
  }
  if (input.customer_note !== undefined &&
      (typeof input.customer_note !== 'string' || input.customer_note.length > 500)) {
    return { valid: false, reason: 'customer_note must be text of at most 500 characters.' };
  }
  return { valid: true, value: {
    request_type: input.request_type,
    amount_minor_units: input.amount_minor_units,
    currency_code: input.currency_code,
    ...(input.request_type === 'withdrawal' ? { beneficiary_id: input.beneficiary_id } : {}),
    ...(input.customer_note ? { customer_note: input.customer_note.trim() } : ''),
    idempotency_key: idempotencyKey
  }};
}

export function registerVantagePayApi(app, { env = process.env, fetchImpl = fetch } = {}) {
  function backendConfig() {
    return {
      authUrl: String(env.VANTAGEPAY_NEON_AUTH_URL || env.NEON_AUTH_BASE_URL || '').replace(/\/$/, ''),
      dataApiUrl: String(env.VANTAGEPAY_NEON_DATA_API_URL || env.NEON_DATA_API_URL || '').replace(/\/$/, '')
    };
  }
  function authReady() {
    return Boolean(backendConfig().authUrl);
  }
  function configReady() {
    // Privileged webhook storage is deliberately fail-closed until the reviewed
    // server-side Neon database adapter and transactional event storage exist.
    // No environment flag can enable these routes prematurely.
    return false;
  }
  app.get('/api/vantagepay/config', (_req, res) => {
    const c = backendConfig();
    if (!c.authUrl) {
      return res.status(503).json({
        success: false,
        code: 'VANTAGEPAY_AUTH_NOT_CONFIGURED',
        message: 'VantagePay standalone Neon authentication is not configured yet.'
      });
    }
    if (!c.dataApiUrl) return res.status(503).json({ success: false, code: 'VANTAGEPAY_DATA_API_NOT_CONFIGURED', message: 'VantagePay Neon Data API is not configured yet.' });
    return res.json({ success: true, neonAuthUrl: c.authUrl, neonDataApiUrl: c.dataApiUrl });
  });

  let jwksCache = null;
  let jwksFetchedAt = 0;
  const JWKS_CACHE_MS = 5 * 60 * 1000;

  async function verifyManagedAuthToken(token, c) {
    const reject = reason => {
      // Never log the token or claims; record only the failed validation stage.
      console.warn('[VantagePay auth] bearer token rejected:', reason);
      return null;
    };
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts.some(part => !part)) return reject('malformed_jwt');

    let header, claims, signature;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      signature = Buffer.from(parts[2], 'base64url');
    } catch {
      return reject('jwt_decode_failed');
    }
    if (!header || header.alg !== 'EdDSA' || typeof header.kid !== 'string') return reject('unexpected_jwt_header');

    // Neon Auth tokens identify the issuer by origin; the configured auth URL
    // also contains the service path (/neondb/auth), which is not part of `iss`.
    const issuer = new URL(c.authUrl).origin;
    const normalizedIssuer = value => String(value || '').replace(/\/+$/, '');
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!claims || normalizedIssuer(claims.iss) !== normalizedIssuer(issuer)) {
      // Issuer identifiers are public protocol metadata, not credentials. Log
      // only these identifiers (never the JWT, subject, email, or other claims)
      // so the configured Neon Auth issuer can be corrected precisely.
      console.warn('[VantagePay auth] issuer mismatch:', {
        tokenIssuer: typeof claims?.iss === 'string' ? claims.iss : '(missing)',
        configuredIssuer: issuer
      });
      return reject('issuer_mismatch');
    }
    if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) {
      return reject('subject_not_uuid');
    }
    if (!Number.isFinite(Number(claims.exp))) {
      return reject('expiry_claim_missing_or_invalid');
    }
    if (Number(claims.exp) <= nowSeconds) {
      return reject('token_expired');
    }
    if (claims.nbf != null && Number(claims.nbf) > nowSeconds + 30) {
      return reject('token_not_yet_valid');
    }

    const jwksUrl = String(env.VANTAGEPAY_NEON_AUTH_JWKS_URL ||
      (c.authUrl.replace(/\/$/, '') + '/.well-known/jwks.json')).trim();
    let keys;
    if (jwksCache && Date.now() - jwksFetchedAt < JWKS_CACHE_MS && jwksCache.url === jwksUrl) {
      keys = jwksCache.keys;
    } else {
      let response;
      try {
        response = await fetchImpl(jwksUrl, { headers: { Accept: 'application/json' } });
      } catch {
        throw new Error('VantagePay signing-key service is unavailable.');
      }
      if (!response.ok) throw new Error('VantagePay signing-key service returned an error.');
      const jwks = await response.json().catch(() => null);
      if (!jwks || !Array.isArray(jwks.keys)) throw new Error('VantagePay signing-key set is invalid.');
      keys = jwks.keys;
      jwksCache = { url: jwksUrl, keys };
      jwksFetchedAt = Date.now();
    }

    const jwk = keys.find(key => key && key.kid === header.kid && key.kty === 'OKP' &&
      key.crv === 'Ed25519' && (!key.alg || key.alg === 'EdDSA') && (!key.use || key.use === 'sig'));
    if (!jwk) return reject('matching_ed25519_signing_key_not_found');
    try {
      const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
      const valid = verifySignature(null, Buffer.from(parts[0] + '.' + parts[1]), publicKey, signature);
      if (!valid) return reject('signature_invalid');
    } catch {
      return reject('signature_verification_error');
    }
    return claims;
  }

  async function requireUser(req, res) {
    const c = backendConfig();
    if (!authReady()) {
      res.status(503).json({ success: false, code: 'VANTAGEPAY_AUTH_NOT_CONFIGURED', message: 'The standalone VantagePay Neon Auth endpoint is not configured.' });
      return null;
    }
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) {
      res.status(401).json({ success: false, message: 'Sign in to continue.' });
      return null;
    }
    let claims;
    try {
      claims = await verifyManagedAuthToken(match[1], c);
    } catch {
      res.status(503).json({ success: false, message: 'VantagePay identity verification is temporarily unavailable.' });
      return null;
    }
    if (!claims) {
      res.status(401).json({ success: false, message: 'Your VantagePay session is invalid or expired. Please sign in again.' });
      return null;
    }

    // Neon Auth's Data API JWT is not a Better Auth cookie-session token, so
    // calling /get-session with it returns an empty session. Verify the JWT
    // signature and standard claims against the branch's published JWKS instead.
    // Some Managed Auth JWTs omit profile claims; reject an explicit unverified
    // claim, while the sign-in UI separately blocks unverified sessions.
    const verificationClaim = claims.emailVerified ?? claims.email_verified;
    if (verificationClaim === false) {
      res.status(403).json({
        success: false,
        code: 'VANTAGEPAY_EMAIL_VERIFICATION_REQUIRED',
        message: 'Verify your email address before accessing VantagePay account features. Request a new verification code from the sign-in page.'
      });
      return null;
    }
    const user = {
      id: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      emailVerified: verificationClaim === true
    };
    return { user, config: c, token: match[1] };
  }

  async function rest(context, table, query, method = 'GET', body = undefined, extraHeaders = {}) {
    // Customer/admin API calls use the signed-in user's Neon Auth JWT against
    // the Neon Data API. No Supabase service-role key or browser-side privileged
    // credential is accepted here. Tables without explicit RLS/grants stay private.
    if (!context || !context.token || !context.config.dataApiUrl) {
      const error = new Error('A user-scoped Neon Data API session is required.');
      error.status = 503;
      throw error;
    }
    const url = context.config.dataApiUrl + '/' + table + (query ? '?' + query : '');
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + context.token,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const error = new Error('VantagePay data request failed.');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function unwrapRpc(value, functionName) {
    if (Array.isArray(value) && value.length === 1 && value[0] && Object.prototype.hasOwnProperty.call(value[0], functionName)) return value[0][functionName];
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, functionName)) return value[functionName];
    return value;
  }


  async function sendVantagePayEmail(to, subject, text) {
    const apiKey = String(env.VANTAGEPAY_RESEND_API_KEY || env.RESEND_API_KEY || '').trim();
    const from = String(env.VANTAGEPAY_EMAIL_FROM || env.RESEND_FROM_EMAIL || '').trim();
    if (!apiKey || !from || !to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to))) return 'not_configured';
    try {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ from, to: [String(to)], subject, text })
      });
      return response.ok ? 'sent' : 'failed';
    } catch { return 'failed'; }
  }

  function emailStatusMessage(status) {
    if (status === 'sent') return ' Email notification sent.';
    if (status === 'not_configured') return ' In-app notification is saved; email delivery awaits the VantagePay sender configuration.';
    return ' In-app notification is saved, but email delivery failed; check the mail provider configuration.';
  }

  async function sendVantagePayAdminNotification(subject, text) {
    const recipient = String(env.VANTAGEPAY_ADMIN_EMAIL || '').trim();
    if (!recipient) return 'not_configured';
    return sendVantagePayEmail(recipient, subject, text);
  }

  app.get('/api/vantagepay/kyc', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const rows = await rest(context, 'vp_customer_kyc',
        'select=id,legal_name,date_of_birth,country_code,address_line1,city,postal_code,identity_document_type,kyc_status,review_note,submitted_at,reviewed_at,created_at,updated_at&user_id=eq.' +
        context.user.id + '&limit=1');
      return res.json({ success: true, kyc: Array.isArray(rows) ? rows[0] || null : null });
    } catch {
      return res.status(503).json({ success: false, message: 'KYC profile service is unavailable until the dedicated VantagePay KYC migration is installed.' });
    }
  });

  app.post('/api/vantagepay/kyc', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const legalName = typeof body.legal_name === 'string' ? body.legal_name.trim() : '';
    const dateOfBirth = typeof body.date_of_birth === 'string' ? body.date_of_birth : '';
    const countryCode = typeof body.country_code === 'string' ? body.country_code.trim().toUpperCase() : '';
    const addressLine1 = typeof body.address_line1 === 'string' ? body.address_line1.trim() : '';
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    const postalCode = typeof body.postal_code === 'string' ? body.postal_code.trim() : '';
    const documentType = body.identity_document_type;
    const dobTime = Date.parse(dateOfBirth + 'T00:00:00Z');
    if (legalName.length < 2 || legalName.length > 160 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || !Number.isFinite(dobTime) ||
        dobTime >= Date.now() || dateOfBirth < '1900-01-01' ||
        (!/^[A-Z]{2}$/.test(countryCode) || countryCode === 'NG') ||
        addressLine1.length < 5 || addressLine1.length > 200 ||
        city.length < 2 || city.length > 100 || postalCode.length > 20 ||
        !['passport','national_id','drivers_license','residence_permit'].includes(documentType)) {
      return res.status(400).json({ success: false, message: 'Complete each required KYC field with valid details. Do not enter a full identity-document number or upload a document on this form.' });
    }
    try {
      const kyc = unwrapRpc(await rest(context, 'rpc/vp_submit_kyc_profile', '', 'POST', {
        p_legal_name: legalName, p_date_of_birth: dateOfBirth, p_country_code: countryCode,
        p_address_line1: addressLine1, p_city: city, p_postal_code: postalCode || null,
        p_identity_document_type: documentType
      }), 'vp_submit_kyc_profile');
      const emailStatus = await sendVantagePayEmail(
        context.user.email,
        'VantagePay KYC profile received',
        'We received your identity profile for review. Current status: pending. This message does not mean your identity has been verified or that banking services are enabled.'
      );
      const adminEmailNotification = await sendVantagePayAdminNotification(
        'VantagePay: new KYC profile awaiting review',
        'A customer submitted a KYC profile for review. Customer email: ' + String(context.user.email || '(not available)') +
          '\nCustomer user ID: ' + context.user.id +
          '\nReview the application in the VantagePay admin dashboard. Do not treat submission as identity verification or financial-service activation.'
      );
      return res.status(200).json({
        success: true, kyc, emailNotification: emailStatus, adminEmailNotification,
        message: 'KYC profile submitted for review. It is not yet verified and does not activate banking services.' + emailStatusMessage(emailStatus)
      });
    } catch (error) {
      if (error && (error.status === 400 || error.status === 422)) return res.status(400).json({ success: false, message: 'The KYC profile was rejected by validation. Check the fields and try again.' });
      return res.status(503).json({ success: false, message: 'KYC profile could not be saved. Confirm the dedicated VantagePay KYC migration and permissions.' });
    }
  });

  app.get('/api/vantagepay/admin/kyc', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const membership = await requireAdmin(context);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled VantagePay admin access is required.' });
      const rows = unwrapRpc(await rest(context, 'rpc/vp_admin_list_kyc', '', 'POST', {}), 'vp_admin_list_kyc');
      return res.json({ success: true, applications: Array.isArray(rows) ? rows : (Array.isArray(rows?.applications) ? rows.applications : []) });
    } catch {
      return res.status(503).json({ success: false, message: 'KYC review queue is unavailable.' });
    }
  });

  app.patch('/api/vantagepay/admin/kyc/:id/status', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    if (!UUID.test(req.params.id || '')) return res.status(400).json({ success: false, message: 'Invalid KYC record ID.' });
    const status = req.body && req.body.status;
    const reason = req.body && req.body.reason;
    if (!['approved','requires_information','rejected'].includes(status)) return res.status(400).json({ success: false, message: 'Choose approved, requires_information, or rejected.' });
    if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 500) return res.status(400).json({ success: false, message: 'Provide an audit reason of 8–500 characters.' });
    try {
      const membership = await requireAdmin(context);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled VantagePay admin access is required.' });
      const updated = unwrapRpc(await rest(context, 'rpc/vp_admin_review_kyc', '', 'POST', {
        p_kyc_id: req.params.id, p_next_status: status, p_reason: reason.trim()
      }), 'vp_admin_review_kyc');
      const row = Array.isArray(updated) ? updated[0] : updated;
      if (!row || typeof row !== 'object') return res.status(409).json({ success: false, message: 'KYC review was not saved.' });
      const emailStatus = await sendVantagePayEmail(
        row.customer_email,
        'VantagePay KYC review update',
        'Your VantagePay KYC review status is now ' + String(row.kyc_status || status).replace(/_/g, ' ') + '. Review note: ' + reason.trim() + '. If more information is required, sign in to your account to review next steps. This status does not activate any financial service.'
      );
      return res.json({ success: true, kyc: row, emailNotification: emailStatus, message: 'KYC review status saved and audited.' + emailStatusMessage(emailStatus) });
    } catch {
      return res.status(503).json({ success: false, message: 'KYC review failed. Confirm the KYC migration, admin membership, and audit permissions.' });
    }
  });

  app.post('/api/vantagepay/webhooks/apy', async (req, res) => {
    const c = backendConfig();
    const secret = env.VANTAGEPAY_APY_WEBHOOK_SECRET || '';
    const providerCode = env.VANTAGEPAY_APY_PROVIDER_CODE || '';
    if (!configReady() || secret.length < 32 || !providerCode) {
      return res.status(503).json({ success: false, message: 'The APY source integration is not configured.' });
    }
    const timestamp = req.get('X-VantagePay-Timestamp') || '';
    const signature = req.get('X-VantagePay-Signature') || '';
    if (!Buffer.isBuffer(req.rawBody) || !verifyVantagePaySignature({
      rawBody: req.rawBody, timestamp, signature, secret
    })) {
      return res.status(401).json({ success: false, message: 'Invalid APY webhook signature or timestamp.' });
    }
    const validation = validateApySourceEvent(req.body);
    if (!validation.valid) return res.status(400).json({ success: false, message: validation.reason });
    const event = validation.event;
    if (!['GBP', 'USD', 'EUR'].includes(event.currency)) {
      return res.status(400).json({ success: false, message: 'This currency is not configured for VantagePay APY records.' });
    }
    try {
      const mappings = await rest({ config: c }, 'vp_external_account_links',
        'select=vantagepay_user_id&provider_code=eq.' + encodeURIComponent(providerCode) +
        '&external_customer_reference=eq.' + encodeURIComponent(event.customer_ref) + '&enabled=eq.true&limit=1');
      if (!Array.isArray(mappings) || mappings.length !== 1) {
        return res.status(422).json({ success: false, message: 'No enabled, reviewed customer mapping exists for this source reference.' });
      }
      const record = {
        provider_code: providerCode,
        source_event_id: event.event_id,
        source_customer_reference: event.customer_ref,
        vantagepay_user_id: mappings[0].vantagepay_user_id,
        period_start: event.period_start,
        period_end: event.period_end,
        currency_code: event.currency,
        amount_minor_units: decimalToMinorUnits(event.amount, 2),
        rate_basis_points: event.rate_basis_points ?? null,
        source_status: 'received',
        source_payload_hash: event.source_record_hash,
        source_occurred_at: event.occurred_at
      };
      const inserted = await rest({ config: c }, 'vp_apy_source_events',
        'on_conflict=provider_code,source_event_id', 'POST', record,
        { Prefer: 'resolution=ignore-duplicates,return=representation' });
      const accepted = Array.isArray(inserted) && inserted.length > 0;
      return res.status(202).json({
        success: true,
        duplicate: !accepted,
        status: accepted ? 'received' : 'duplicate',
        message: accepted
          ? 'APY source event received for reconciliation. No customer balance has been credited.'
          : 'Duplicate source event ignored. No customer balance has been credited.'
      });
    } catch {
      return res.status(503).json({ success: false, message: 'APY source event could not be stored. No customer balance has been credited.' });
    }
  });

  // Generic signed event intake for a separately configured external rewards provider; events are not auto-credited.
  // relationship. Events are stored for review/reconciliation and never credited here.
  app.post('/api/vantagepay/webhooks/rewards', async (req, res) => {
    const c = backendConfig();
    const secret = env.VANTAGEPAY_REWARD_WEBHOOK_SECRET || '';
    const providerCode = env.VANTAGEPAY_REWARD_PROVIDER_CODE || '';
    if (!configReady() || secret.length < 32 || !providerCode) {
      return res.status(503).json({ success: false, message: 'The external rewards integration is not configured.' });
    }
    const timestamp = req.get('X-VantagePay-Timestamp') || '';
    const signature = req.get('X-VantagePay-Signature') || '';
    if (!Buffer.isBuffer(req.rawBody) || !verifyVantagePaySignature({ rawBody: req.rawBody, timestamp, signature, secret })) {
      return res.status(401).json({ success: false, message: 'Invalid rewards webhook signature or timestamp.' });
    }
    const event = req.body;
    const types = new Set(['apy', 'bonus', 'investment_return', 'dividend', 'other']);
    const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
    if (!event || typeof event !== 'object' || Array.isArray(event) ||
        typeof event.event_id !== 'string' || !identifier.test(event.event_id) ||
        typeof event.customer_ref !== 'string' || !identifier.test(event.customer_ref) ||
        !types.has(event.reward_type) ||
        typeof event.currency !== 'string' || !['GBP', 'USD', 'EUR'].includes(event.currency) ||
        typeof event.amount !== 'string' || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(event.amount) || !/[1-9]/.test(event.amount) ||
        typeof event.source_record_hash !== 'string' || !/^[a-f0-9]{64}$/i.test(event.source_record_hash) ||
        typeof event.occurred_at !== 'string' || !Number.isFinite(Date.parse(event.occurred_at)) ||
        (event.plan_reference !== undefined && (typeof event.plan_reference !== 'string' || event.plan_reference.length > 200))) {
      return res.status(400).json({ success: false, message: 'The external reward event is invalid.' });
    }
    try {
      const mappings = await rest({ config: c }, 'vp_external_account_links',
        'select=vantagepay_user_id&provider_code=eq.' + encodeURIComponent(providerCode) +
        '&external_customer_reference=eq.' + encodeURIComponent(event.customer_ref) + '&enabled=eq.true&limit=1');
      if (!Array.isArray(mappings) || mappings.length !== 1) {
        return res.status(422).json({ success: false, message: 'No enabled, reviewed customer mapping exists for this external customer reference.' });
      }
      const record = {
        provider_code: providerCode,
        source_event_id: event.event_id,
        external_customer_reference: event.customer_ref,
        vantagepay_user_id: mappings[0].vantagepay_user_id,
        reward_type: event.reward_type,
        plan_reference: event.plan_reference || null,
        period_start: event.period_start || null,
        period_end: event.period_end || null,
        currency_code: event.currency,
        amount_minor_units: decimalToMinorUnits(event.amount, 2),
        source_payload_hash: event.source_record_hash.toLowerCase(),
        source_occurred_at: new Date(Date.parse(event.occurred_at)).toISOString(),
        source_status: 'received'
      };
      const inserted = await rest({ config: c }, 'vp_external_reward_events',
        'on_conflict=provider_code,source_event_id', 'POST', record,
        { Prefer: 'resolution=ignore-duplicates,return=representation' });
      const accepted = Array.isArray(inserted) && inserted.length > 0;
      return res.status(202).json({
        success: true, duplicate: !accepted, status: accepted ? 'received' : 'duplicate',
        message: accepted
          ? 'External reward received for review and reconciliation. No balance has been credited.'
          : 'Duplicate external reward ignored. No balance has been credited.'
      });
    } catch {
      return res.status(503).json({ success: false, message: 'External reward could not be stored. No balance has been credited.' });
    }
  });

  app.get('/api/vantagepay/client-profile', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const rows = await rest(context, 'vp_customer_profiles',
        'select=user_id,display_name,phone_number,city,country_code,avatar_url,created_at,updated_at&user_id=eq.' +
        context.user.id + '&limit=1');
      const profile = Array.isArray(rows) ? rows[0] || null : null;
      return res.json({ success: true, profile: profile || {
        user_id: context.user.id,
        display_name: '',
        phone_number: null,
        city: null,
        country_code: null,
        avatar_url: null,
        email: context.user.email || null
      }});
    } catch {
      return res.status(503).json({ success: false, code: 'VANTAGEPAY_CLIENT_PROFILE_MIGRATION_REQUIRED', message: 'Client profile storage is unavailable. Apply the dedicated VantagePay client-profile migration first.' });
    }
  });

  app.post('/api/vantagepay/client-profile', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    const phoneNumber = typeof body.phone_number === 'string' ? body.phone_number.trim() : '';
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    const countryCode = typeof body.country_code === 'string' ? body.country_code.trim().toUpperCase() : '';
    const avatarUrl = typeof body.avatar_url === 'string' ? body.avatar_url.trim() : '';
    if (displayName.length > 100 ||
        (phoneNumber && !/^\+?[0-9 ()-]{7,24}$/.test(phoneNumber)) ||
        city.length > 100 ||
        (countryCode && (!/^[A-Z]{2}$/.test(countryCode) || countryCode === 'NG')) ||
        (avatarUrl && (avatarUrl.length > 2048 || !/^https:\/\//i.test(avatarUrl)))) {
      return res.status(400).json({ success: false, message: 'Check the profile fields. Phone, country code, and avatar URL must use the supported formats.' });
    }
    const record = {
      user_id: context.user.id,
      display_name: displayName,
      phone_number: phoneNumber || null,
      city: city || null,
      country_code: countryCode || null,
      avatar_url: avatarUrl || null,
      updated_at: new Date().toISOString()
    };
    try {
      const rows = await rest(context, 'vp_customer_profiles',
        'on_conflict=user_id', 'POST', record,
        { Prefer: 'resolution=merge-duplicates,return=representation' });
      const profile = Array.isArray(rows) ? rows[0] || null : null;
      if (!profile) return res.status(503).json({ success: false, message: 'Profile was not returned after saving. Confirm the dedicated VantagePay profile migration and permissions.' });
      const adminEmailNotification = await sendVantagePayAdminNotification(
        'VantagePay: customer profile submitted or updated',
        'A customer submitted or updated their VantagePay client profile. Name: ' + String(profile.display_name || displayName || '(not provided)') +
          '\nCustomer email: ' + String(context.user.email || '(not available)') +
          '\nCustomer user ID: ' + context.user.id +
          '\nReview the customer profile and account status in the VantagePay admin dashboard.'
      );
      return res.json({ success: true, profile, adminEmailNotification, message: 'Your VantagePay client profile was saved.' });
    } catch {
      return res.status(503).json({ success: false, code: 'VANTAGEPAY_CLIENT_PROFILE_MIGRATION_REQUIRED', message: 'Profile could not be saved. Confirm the dedicated VantagePay client-profile migration and permissions.' });
    }
  });

  app.get('/api/vantagepay/account', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      let account = unwrapRpc(await rest(context, 'rpc/vp_ensure_customer_account', '', 'POST', {}), 'vp_ensure_customer_account');
      if (Array.isArray(account)) account = account[0] || null;
      return res.json({ success: true, account: account && typeof account === 'object' ? account : null });
    } catch {
      return res.status(503).json({ success: false, message: 'Account details are unavailable. Confirm the standalone schema has been reviewed and applied.' });
    }
  });

  app.get('/api/vantagepay/demo-bank-account', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const result = unwrapRpc(await rest(context, 'rpc/vp_customer_demo_bank_account', '', 'POST', {}), 'vp_customer_demo_bank_account');
      const data = Array.isArray(result) ? result[0] : result;
      return res.json({ success: true, application: data?.application || null, account: data?.account || null });
    } catch {
      return res.status(503).json({ success: false, message: 'Sandbox account details are unavailable. Confirm the VantagePay sandbox account-opening migration is applied.' });
    }
  });

  app.post('/api/vantagepay/demo-bank-account', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    const currency = req.body && req.body.currency_code;
    const country = req.body && req.body.country_code;
    const note = req.body && req.body.customer_note;
    if (!['GBP','USD','EUR'].includes(currency)) return res.status(400).json({ success: false, message: 'Choose a supported test-account currency.' });
    if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country) || country === 'NG') return res.status(400).json({ success: false, message: 'Enter a two-letter country code.' });
    if (note !== undefined && (typeof note !== 'string' || note.length > 500)) return res.status(400).json({ success: false, message: 'Application note must be at most 500 characters.' });
    try {
      const result = unwrapRpc(await rest(context, 'rpc/vp_customer_open_demo_account', '', 'POST', {
        p_currency_code: currency, p_country_code: country, p_customer_note: note || null
      }), 'vp_customer_open_demo_account');
      const data = Array.isArray(result) ? result[0] : result;
      if (!data || typeof data !== 'object') return res.status(409).json({ success: false, message: 'Sandbox account application was not returned.' });
      return res.status(202).json({ success: true, application: data.application || null, message: data.message || 'Sandbox account application submitted.' });
    } catch (error) {
      const upstreamStatus = Number.isInteger(error?.status) ? error.status : null;
      return res.status(upstreamStatus === 401 || upstreamStatus === 403 ? 403 : 503).json({
        success: false, message: upstreamStatus === 401 || upstreamStatus === 403
          ? 'Your customer profile must be approved before applying for a sandbox account.'
          : 'Sandbox account application could not be submitted. Confirm the account-opening migration and permissions.'
      });
    }
  });

  app.get('/api/vantagepay/account-activity', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const result = unwrapRpc(await rest(context, 'rpc/vp_customer_ledger_snapshot', '', 'POST', {}), 'vp_customer_ledger_snapshot');
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return res.status(503).json({ success: false, message: 'Customer ledger snapshot returned an invalid response.' });
      }
      return res.json({
        success: true,
        transactions: Array.isArray(result.transactions) ? result.transactions : [],
        balances: Array.isArray(result.balances) ? result.balances : []
      });
    } catch {
      return res.status(503).json({ success: false, code: 'VANTAGEPAY_LEDGER_SNAPSHOT_UNAVAILABLE', message: 'Account history and balances are unavailable until the read-only ledger migration is installed.' });
    }
  });

  app.get('/api/vantagepay/notifications', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const rows = await rest(context, 'vp_customer_notifications',
        'select=id,notification_type,title,message,related_request_id,read_at,created_at&user_id=eq.' +
        context.user.id + '&order=created_at.desc&limit=100');
      return res.json({ success: true, notifications: Array.isArray(rows) ? rows : [] });
    } catch {
      return res.status(503).json({ success: false, message: 'Notifications are unavailable until the VantagePay notification schema is installed.' });
    }
  });

  app.patch('/api/vantagepay/notifications/:id/read', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    if (!UUID.test(req.params.id || '')) return res.status(400).json({ success: false, message: 'Invalid notification ID.' });
    try {
      const result = unwrapRpc(await rest(context, 'rpc/vp_mark_notification_read', '', 'POST', {
        p_notification_id: req.params.id
      }), 'vp_mark_notification_read');
      const notification = Array.isArray(result) ? result[0] : result;
      if (!notification || typeof notification !== 'object') return res.status(404).json({ success: false, message: 'Notification not found.' });
      return res.json({ success: true, notification });
    } catch {
      return res.status(503).json({ success: false, message: 'Notification could not be marked as read.' });
    }
  });

  async function requireAdmin(context, allowedRoles = ['support', 'operations', 'finance', 'super_admin']) {
    const memberships = await rest(context, 'vp_admin_memberships',
      'select=admin_role,enabled&user_id=eq.' + context.user.id + '&enabled=eq.true&limit=1');
    return Array.isArray(memberships) && memberships.length === 1 &&
      allowedRoles.includes(memberships[0].admin_role) ? memberships[0] : null;
  }

  app.get('/api/vantagepay/admin/operations-snapshot', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const membership = await requireAdmin(context);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled VantagePay admin access is required.' });
      const snapshot = unwrapRpc(await rest(context, 'rpc/vp_admin_operations_snapshot', '', 'POST', {}), 'vp_admin_operations_snapshot');
      if (!snapshot || typeof snapshot !== 'object') return res.status(403).json({ success: false, message: 'Operations snapshot unavailable or admin membership could not be verified by the database.' });
      return res.json({ success: true, snapshot });
    } catch (error) {
      // Keep the response safe for an authenticated admin while making the real
      // upstream failure diagnosable. Never log the bearer token or request headers.
      const upstreamStatus = Number.isInteger(error && error.status) ? error.status : null;
      const upstreamCode = String(error && error.data && (error.data.code || error.data.error || error.data.hint) || '').slice(0, 80) || null;
      console.error('[VantagePay operations snapshot] Data API request failed', {
        upstreamStatus,
        upstreamCode,
        message: String(error && error.message || 'unknown_error').slice(0, 160)
      });
      return res.status(503).json({
        success: false,
        code: 'VANTAGEPAY_OPERATIONS_SNAPSHOT_FAILED',
        upstreamStatus,
        upstreamCode,
        message: 'Read-only Operations overview is unavailable. Diagnostic status: ' +
          (upstreamStatus === null ? 'connection/configuration failure' : 'Data API HTTP ' + upstreamStatus) +
          (upstreamCode ? ' (' + upstreamCode + ')' : '') +
          '. No balance changes were made.'
      });
    }
  });

  app.get('/api/vantagepay/admin/customer-profiles', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const membership = await requireAdmin(context);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled VantagePay admin access is required.' });
      const rows = unwrapRpc(await rest(context, 'rpc/vp_admin_list_customer_profiles', '', 'POST', {}), 'vp_admin_list_customer_profiles');
      return res.json({ success: true, profiles: Array.isArray(rows) ? rows : [] });
    } catch {
      return res.status(503).json({ success: false, message: 'Customer profile approval queue is unavailable. Confirm the profile approval migration has been applied.' });
    }
  });

  app.get('/api/vantagepay/admin/demo-account-applications', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const membership = await requireAdmin(context, ['operations','finance','super_admin']);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled operations, finance, or super-admin access is required.' });
      const rows = unwrapRpc(await rest(context, 'rpc/vp_admin_list_demo_account_applications', '', 'POST', {}), 'vp_admin_list_demo_account_applications');
      return res.json({ success: true, applications: Array.isArray(rows) ? rows : [] });
    } catch (error) {
      const upstreamStatus = Number.isInteger(error && error.status) ? error.status : null;
      const upstreamCode = String(error && error.data && (error.data.code || error.data.error || error.data.hint) || '').slice(0, 80) || null;
      console.error('[VantagePay sandbox application queue] Data API request failed', {
        upstreamStatus, upstreamCode,
        message: String(error && error.message || 'unknown_error').slice(0, 160)
      });
      return res.status(503).json({
        success: false,
        code: 'VANTAGEPAY_SANDBOX_QUEUE_FAILED',
        upstreamStatus,
        upstreamCode,
        message: 'Sandbox account application queue could not be loaded. Diagnostic status: ' +
          (upstreamStatus === null ? 'connection/configuration failure' : 'Data API HTTP ' + upstreamStatus) +
          (upstreamCode ? ' (' + upstreamCode + ')' : '') + '. No application was changed.'
      });
    }
  });

  app.patch('/api/vantagepay/admin/demo-account-applications/:id/status', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    const id = req.params.id || '';
    const nextStatus = req.body && req.body.status;
    const reason = req.body && req.body.reason;
    if (!UUID.test(id)) return res.status(400).json({ success: false, message: 'Invalid sandbox application ID.' });
    if (!['approved','rejected'].includes(nextStatus)) return res.status(400).json({ success: false, message: 'Choose approve or reject.' });
    if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 500) return res.status(400).json({ success: false, message: 'Provide an audit reason of 8–500 characters.' });
    try {
      const membership = await requireAdmin(context, ['operations','finance','super_admin']);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled operations, finance, or super-admin access is required.' });
      const result = unwrapRpc(await rest(context, 'rpc/vp_admin_review_demo_account_application', '', 'POST', {
        p_application_id: id, p_next_status: nextStatus, p_reason: reason.trim()
      }), 'vp_admin_review_demo_account_application');
      const data = Array.isArray(result) ? result[0] : result;
      if (!data || typeof data !== 'object') return res.status(409).json({ success: false, message: 'Sandbox application review was not saved.' });
      return res.json({ success: true, application: data.application || null, account: data.account || null,
        message: nextStatus === 'approved'
          ? 'Application approved. Synthetic TEST account details have been issued; they are not a real bank account.'
          : 'Sandbox account application rejected and audit logged.' });
    } catch (error) {
      const upstreamStatus = Number.isInteger(error && error.status) ? error.status : null;
      const upstreamCode = String(error && error.data && (error.data.code || error.data.error || error.data.hint) || '').slice(0, 80) || null;
      console.error('[VantagePay sandbox application review] Data API request failed', {
        upstreamStatus, upstreamCode,
        message: String(error && error.message || 'unknown_error').slice(0, 160)
      });
      return res.status(503).json({
        success: false,
        code: 'VANTAGEPAY_SANDBOX_REVIEW_FAILED',
        upstreamStatus,
        upstreamCode,
        message: 'Sandbox application review could not be saved. Diagnostic status: ' +
          (upstreamStatus === null ? 'connection/configuration failure' : 'Data API HTTP ' + upstreamStatus) +
          (upstreamCode ? ' (' + upstreamCode + ')' : '') + '. No decision was recorded.'
      });
    }
  });

  app.patch('/api/vantagepay/admin/customer-profiles/:userId/status', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    const userId = req.params.userId || '';
    if (!UUID.test(userId)) return res.status(400).json({ success: false, message: 'Invalid customer account ID.' });
    const status = req.body && req.body.status;
    const reason = req.body && req.body.reason;
    if (!['active', 'restricted'].includes(status)) return res.status(400).json({ success: false, message: 'Choose approve or reject.' });
    if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 500) return res.status(400).json({ success: false, message: 'Provide an audit reason of 8–500 characters.' });
    try {
      const membership = await requireAdmin(context);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled VantagePay admin access is required.' });
      const updated = unwrapRpc(await rest(context, 'rpc/vp_admin_review_customer_profile', '', 'POST', {
        p_customer_user_id: userId, p_next_status: status, p_reason: reason.trim()
      }), 'vp_admin_review_customer_profile');
      const row = Array.isArray(updated) ? updated[0] : updated;
      if (!row || typeof row !== 'object') return res.status(409).json({ success: false, message: 'Customer profile review was not saved.' });
      return res.json({ success: true, profile: row, message: 'Customer profile decision saved and audit logged. ' + (status === 'active' ? 'Account access status is now active; KYC and financial services remain separately controlled.' : 'Account status is restricted.') });
    } catch {
      return res.status(503).json({ success: false, message: 'Customer profile review failed. Confirm the approval migration and audit permissions.' });
    }
  });

  app.post('/api/vantagepay/admin/balance-adjustments', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    // Intentionally unavailable: the current ledger schema has no reviewed
    // currency/account-balance model. Do not simulate a balance change or write
    // a one-sided ledger entry. This remains disabled until an accounting design
    // and balanced, idempotent transaction procedure are reviewed and tested.
    return res.status(503).json({
      success: false,
      code: 'VANTAGEPAY_LEDGER_MODEL_NOT_REVIEWED',
      message: 'Balance adjustments are disabled until the ledger accounting model and audited posting procedure are implemented and tested. No balance was changed.'
    });
  });

  app.get('/api/vantagepay/admin/transaction-requests', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const membership = await requireAdmin(context);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled VantagePay admin access is required.' });
      // The customer JWT cannot read across customers under RLS. Use the
      // narrowly scoped SECURITY DEFINER RPC, which re-checks the actor role in SQL.
      const rows = await rest(context, 'rpc/vp_admin_list_transaction_requests', '', 'POST', {
        p_actor_user_id: context.user.id
      });
      return res.json({ success: true, requests: Array.isArray(rows) ? rows : [] });
    } catch {
      return res.status(503).json({ success: false, message: 'Admin request queue is unavailable.' });
    }
  });

  app.patch('/api/vantagepay/admin/transaction-requests/:id/status', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    const id = req.params.id || '';
    const nextStatus = req.body && req.body.status;
    const reason = req.body && req.body.reason;
    if (!UUID.test(id)) return res.status(400).json({ success: false, message: 'Invalid transaction request ID.' });
    if (!['under_review', 'submitted', 'rejected', 'cancelled'].includes(nextStatus)) {
      return res.status(400).json({ success: false, message: 'This status requires an approved provider settlement workflow or is not allowed.' });
    }
    if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 500) {
      return res.status(400).json({ success: false, message: 'Provide an audit reason of 8–500 characters.' });
    }
    try {
      const membership = await requireAdmin(context, ['operations', 'finance', 'super_admin']);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled operations, finance, or super-admin access is required.' });
      const updated = unwrapRpc(await rest(context, 'rpc/vp_admin_update_request_status', '', 'POST', {
        p_actor_user_id: context.user.id,
        p_request_id: id,
        p_next_status: nextStatus,
        p_reason: reason.trim()
      }), 'vp_admin_update_request_status');
      if (!updated || typeof updated !== 'object') return res.status(409).json({ success: false, message: 'Request status was not updated.' });
      const emailStatus = await sendVantagePayEmail(
        updated.customer_email,
        'VantagePay request status update',
        'Your VantagePay request ' + String(updated.request_reference || id) + ' status changed to ' +
          String(updated.status || nextStatus) + '. This is a request-status update only; it does not mean money moved or settled.'
      );
      return res.json({
        success: true, request: updated, emailNotification: emailStatus,
        message: 'Request status updated and audit logged. This action does not move money or change a balance.' + emailStatusMessage(emailStatus)
      });
    } catch {
      return res.status(503).json({ success: false, message: 'Admin request update failed. Confirm the standalone schema and audit permissions.' });
    }
  });

  app.get('/api/vantagepay/beneficiaries', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const rows = await rest(context, 'vp_beneficiary_accounts',
        'select=id,beneficiary_name,bank_name,country_code,currency_code,account_last4,verification_status,is_default,created_at&user_id=eq.' + context.user.id + '&order=created_at.desc');
      return res.json({ success: true, beneficiaries: Array.isArray(rows) ? rows : [] });
    } catch {
      return res.status(503).json({ success: false, message: 'Beneficiary accounts are unavailable.' });
    }
  });

  app.post('/api/vantagepay/beneficiaries', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    // No direct bank-account collection: beneficiary creation must be completed
    // through a reviewed provider-hosted verification adapter.
    if (!env.VANTAGEPAY_BENEFICIARY_PROVIDER_ADAPTER_URL ||
        !env.VANTAGEPAY_BENEFICIARY_PROVIDER_ADAPTER_SECRET) {
      return res.status(503).json({
        success: false,
        code: 'BENEFICIARY_PROVIDER_NOT_CONFIGURED',
        message: 'Secure beneficiary linking is not enabled yet. Do not send bank account details through this form.'
      });
    }
    return res.status(501).json({
      success: false,
      code: 'BENEFICIARY_ADAPTER_NOT_IMPLEMENTED',
      message: 'The configured beneficiary adapter must be implemented and security-reviewed before linking can be enabled.'
    });
  });

  app.get('/api/vantagepay/transaction-requests', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const rows = await rest(context, 'vp_transaction_requests',
        'select=request_reference,request_type,amount_minor_units,currency_code,status,provider_reference,customer_note,created_at,updated_at,settled_at,beneficiary:vp_beneficiary_accounts(id,beneficiary_name,bank_name,account_last4,currency_code)&user_id=eq.' + context.user.id + '&order=created_at.desc&limit=100');
      return res.json({ success: true, requests: Array.isArray(rows) ? rows : [] });
    } catch {
      return res.status(503).json({ success: false, message: 'Transaction requests are unavailable.' });
    }
  });

  app.post('/api/vantagepay/transaction-requests', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const accountRows = await rest(context, 'vp_customer_accounts',
        'select=account_status&user_id=eq.' + context.user.id + '&limit=1');
      if (!Array.isArray(accountRows) || accountRows.length !== 1 || accountRows[0].account_status !== 'active') {
        return res.status(403).json({ success: false, code: 'VANTAGEPAY_ACCOUNT_APPROVAL_REQUIRED', message: 'Your VantagePay account profile must be approved by an administrator before submitting deposit or withdrawal requests.' });
      }
    } catch {
      return res.status(503).json({ success: false, message: 'Account approval status could not be verified. No request was recorded.' });
    }
    const validation = validateTransactionRequest(req.body, req.get('Idempotency-Key'));
    if (!validation.valid) return res.status(400).json({ success: false, message: validation.reason });
    const input = validation.value;

    function sameRequest(row) {
      return Boolean(row &&
        row.user_id === context.user.id &&
        row.request_type === input.request_type &&
        String(row.amount_minor_units) === input.amount_minor_units &&
        String(row.currency_code).trim() === input.currency_code &&
        (row.beneficiary_id || null) === (input.beneficiary_id || null) &&
        (row.customer_note || '') === (input.customer_note || ''));
    }
    async function findExistingRequest() {
      const rows = await rest(context, 'vp_transaction_requests',
        'select=id,request_reference,user_id,request_type,amount_minor_units,currency_code,beneficiary_id,idempotency_key,customer_note,status,created_at,updated_at&user_id=eq.' +
        context.user.id + '&idempotency_key=eq.' + encodeURIComponent(input.idempotency_key) + '&limit=1');
      return Array.isArray(rows) ? rows[0] || null : null;
    }

    try {
      // Idempotent retries return the original request only when the payload matches.
      const existing = await findExistingRequest();
      if (existing) {
        if (!sameRequest(existing)) {
          return res.status(409).json({ success: false, message: 'This idempotency key was already used for a different request.' });
        }
        return res.status(200).json({
          success: true, duplicate: true, request: existing,
          message: 'This request was already recorded. No money was moved.'
        });
      }
      if (input.request_type === 'withdrawal') {
        const beneficiary = await rest(context, 'vp_beneficiary_accounts',
          'select=id&user_id=eq.' + context.user.id + '&id=eq.' + input.beneficiary_id + '&verification_status=eq.verified&limit=1');
        if (!Array.isArray(beneficiary) || beneficiary.length !== 1) {
          return res.status(400).json({ success: false, message: 'Select a verified beneficiary belonging to your VantagePay account.' });
        }
      }
      const requestReference = 'VPR-' + randomUUID().replace(/-/g, '').toUpperCase();
      const inserted = await rest(context, 'vp_transaction_requests', '',
        'POST', {
          request_reference: requestReference,
          user_id: context.user.id,
          request_type: input.request_type,
          amount_minor_units: input.amount_minor_units,
          currency_code: input.currency_code,
          ...(input.beneficiary_id ? { beneficiary_id: input.beneficiary_id } : {}),
          idempotency_key: input.idempotency_key,
          customer_note: input.customer_note || null,
          customer_email: context.user.email || null,
          status: 'pending'
        }, { Prefer: 'return=representation' });
      const row = Array.isArray(inserted) ? inserted[0] : null;
      const emailStatus = await sendVantagePayEmail(
        context.user.email,
        'VantagePay ' + input.request_type + ' request received',
        'We received your ' + input.request_type + ' request ' + requestReference + ' for ' +
          input.amount_minor_units + ' minor units ' + input.currency_code +
          '. It is pending review only. No money was moved or settled.'
      );
      const adminEmailNotification = await sendVantagePayAdminNotification(
        'VantagePay: new ' + input.request_type + ' request awaiting review',
        'A customer submitted a new ' + input.request_type + ' request. Reference: ' + requestReference +
          '\nAmount: ' + input.amount_minor_units + ' minor units ' + input.currency_code +
          '\nCustomer email: ' + String(context.user.email || '(not available)') +
          '\nCustomer user ID: ' + context.user.id +
          '\nStatus: pending review. This request does not move money or confirm settlement.'
      );
      return res.status(201).json({
        success: true,
        request: row,
        emailNotification: emailStatus,
        adminEmailNotification,
        message: 'Request recorded for review only. This does not move money or confirm a deposit, withdrawal, or settlement.' + emailStatusMessage(emailStatus)
      });
    } catch (error) {
      if (error && error.status === 409) {
        // A concurrent retry may have inserted the row after our first lookup.
        try {
          const existing = await findExistingRequest();
          if (existing && sameRequest(existing)) {
            return res.status(200).json({
              success: true, duplicate: true, request: existing,
              message: 'This request was already recorded. No money was moved.'
            });
          }
        } catch { /* Return conflict if the idempotency record cannot be confirmed. */ }
        return res.status(409).json({ success: false, message: 'This idempotency key was already used or the request reference conflicted.' });
      }
      return res.status(503).json({ success: false, message: 'The request could not be recorded. No money was moved.' });
    }
  });
}
