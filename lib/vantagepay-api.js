import { randomUUID } from 'node:crypto';
import { verifyVantagePaySignature } from './vantagepay-webhook.js';
import { validateApySourceEvent, decimalToMinorUnits } from './vantagepay-apy.js';

const CURRENCIES = new Set(['GBP', 'USD', 'EUR', 'NGN']);
const MINOR_UNITS = /^[1-9]\d{0,35}$/;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      dataApiUrl: String(env.VANTAGEPAY_NEON_DATA_API_URL || env.NEON_DATA_API_URL || '').replace(/\/$/, ''),
      url: String(env.VANTAGEPAY_NEON_DATA_API_URL || env.NEON_DATA_API_URL || '').replace(/\/$/, '')
    };
  }
  function authReady() {
    return Boolean(backendConfig().authUrl);
  }
  function configReady() {
    const c = backendConfig();
    // Privileged webhook storage is intentionally disabled until a reviewed
    // server-side Neon database adapter is implemented. Never reuse Supabase keys.
    return Boolean(env.VANTAGEPAY_NEON_PRIVILEGED_ADAPTER_READY === 'true' &&
      env.VANTAGEPAY_NEON_DATABASE_URL && c.dataApiUrl);
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
    let response;
    try {
      response = await fetchImpl(c.authUrl + '/get-session', {
        headers: { Authorization: 'Bearer ' + match[1], Accept: 'application/json' }
      });
    } catch {
      res.status(503).json({ success: false, message: 'VantagePay Neon Auth is unavailable.' });
      return null;
    }
    if (!response.ok) {
      res.status(401).json({ success: false, message: 'Your VantagePay session is invalid or expired.' });
      return null;
    }
    const sessionData = await response.json().catch(() => null);
    const user = sessionData && (sessionData.user || sessionData.session?.user);
    if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) {
      res.status(401).json({ success: false, message: 'Neon Auth returned no valid signed-in user.' });
      return null;
    }
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
    if (!['GBP', 'USD', 'EUR', 'NGN'].includes(event.currency)) {
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

  // Generic signed event intake for the separate AlpsCoinChain Investment Ventures
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
        typeof event.currency !== 'string' || !['GBP', 'USD', 'EUR', 'NGN'].includes(event.currency) ||
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

  app.get('/api/vantagepay/account', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const rows = await rest(context, 'vp_customer_accounts',
        'select=user_id,account_reference,display_name,account_status,created_at&user_id=eq.' + context.user.id + '&limit=1');
      return res.json({ success: true, account: Array.isArray(rows) ? rows[0] || null : null });
    } catch {
      return res.status(503).json({ success: false, message: 'Account details are unavailable. Confirm the standalone schema has been reviewed and applied.' });
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
      const rows = await rest(context, 'vp_customer_notifications',
        'id=eq.' + req.params.id + '&user_id=eq.' + context.user.id,
        'PATCH', { read_at: new Date().toISOString() }, { Prefer: 'return=representation' });
      if (!Array.isArray(rows) || rows.length !== 1) return res.status(404).json({ success: false, message: 'Notification not found.' });
      return res.json({ success: true, notification: rows[0] });
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

  app.post('/api/vantagepay/admin/balance-adjustments', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    const input = req.body || {};
    if (!UUID.test(input.customer_user_id || '')) return res.status(400).json({ success: false, message: 'A valid customer user ID is required.' });
    if (typeof input.amount_minor_units !== 'string' || !MINOR_UNITS.test(input.amount_minor_units)) {
      return res.status(400).json({ success: false, message: 'Amount must be a positive integer string in minor units.' });
    }
    if (!CURRENCIES.has(input.currency_code)) return res.status(400).json({ success: false, message: 'Unsupported currency.' });
    if (!['credit', 'debit'].includes(input.direction)) return res.status(400).json({ success: false, message: 'Direction must be credit or debit.' });
    if (typeof input.reason !== 'string' || input.reason.trim().length < 8 || input.reason.length > 500) {
      return res.status(400).json({ success: false, message: 'Provide an audit reason of 8–500 characters.' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || '';
    if (!IDEMPOTENCY.test(idempotencyKey)) return res.status(400).json({ success: false, message: 'A valid Idempotency-Key header is required.' });
    try {
      const membership = await requireAdmin(context, ['finance', 'super_admin']);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled finance or super-admin access is required for balance adjustments.' });
      const result = await rest(context, 'rpc/vp_admin_adjust_customer_balance', '', 'POST', {
        p_actor_user_id: context.user.id,
        p_customer_user_id: input.customer_user_id,
        p_amount_minor_units: input.amount_minor_units,
        p_currency_code: input.currency_code,
        p_direction: input.direction,
        p_reason: input.reason.trim(),
        p_idempotency_key: idempotencyKey
      });
      return res.status(201).json({
        success: true,
        transaction_id: result,
        message: 'Audited balanced-ledger adjustment posted. Customer notification and audit record were created.'
      });
    } catch (error) {
      if (error && error.status === 409) return res.status(409).json({ success: false, message: 'This adjustment idempotency key has already been used.' });
      return res.status(503).json({ success: false, message: 'Balance adjustment failed. Confirm the reviewed standalone schema and admin permissions; no balance update is assumed.' });
    }
  });

  app.get('/api/vantagepay/admin/transaction-requests', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    try {
      const membership = await requireAdmin(context);
      if (!membership) return res.status(403).json({ success: false, message: 'Enabled VantagePay admin access is required.' });
      const rows = await rest(context, 'vp_transaction_requests',
        'select=id,request_reference,user_id,request_type,amount_minor_units,currency_code,beneficiary_id,status,provider_reference,customer_note,created_at,updated_at&order=created_at.desc&limit=200');
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
      const updated = await rest(context, 'rpc/vp_admin_update_request_status', '', 'POST', {
        p_actor_user_id: context.user.id,
        p_request_id: id,
        p_next_status: nextStatus,
        p_reason: reason.trim()
      });
      if (!updated || typeof updated !== 'object') return res.status(409).json({ success: false, message: 'Request status was not updated.' });
      return res.json({
        success: true, request: updated,
        message: 'Request status updated, audit logged, and customer notification queued. This action does not move money or change a balance.'
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
          status: 'pending'
        }, { Prefer: 'return=representation' });
      const row = Array.isArray(inserted) ? inserted[0] : null;
      return res.status(201).json({
        success: true,
        request: row,
        message: 'Request recorded for review only. This does not move money or confirm a deposit, withdrawal, or settlement.'
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
