import { randomUUID } from 'node:crypto';

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
      url: String(env.VANTAGEPAY_SUPABASE_URL || '').replace(/\/$/, ''),
      publishableKey: env.VANTAGEPAY_SUPABASE_PUBLISHABLE_KEY || '',
      serviceKey: env.VANTAGEPAY_SUPABASE_SERVICE_ROLE_KEY || ''
    };
  }
  function configReady() {
    const c = backendConfig();
    return Boolean(c.url && c.publishableKey && c.serviceKey);
  }
  app.get('/api/vantagepay/config', (_req, res) => {
    const c = backendConfig();
    if (!c.url || !c.publishableKey) {
      return res.status(503).json({
        success: false,
        code: 'VANTAGEPAY_BACKEND_NOT_CONFIGURED',
        message: 'VantagePay standalone authentication is not configured yet. No other product account is used.'
      });
    }
    return res.json({ success: true, supabaseUrl: c.url, publishableKey: c.publishableKey });
  });

  async function requireUser(req, res) {
    const c = backendConfig();
    if (!configReady()) {
      res.status(503).json({ success: false, code: 'VANTAGEPAY_BACKEND_NOT_CONFIGURED', message: 'The standalone VantagePay backend is not configured.' });
      return null;
    }
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) {
      res.status(401).json({ success: false, message: 'Sign in to continue.' });
      return null;
    }
    let response;
    try {
      response = await fetchImpl(c.url + '/auth/v1/user', {
        headers: { apikey: c.publishableKey, Authorization: 'Bearer ' + match[1] }
      });
    } catch {
      res.status(503).json({ success: false, message: 'VantagePay authentication service is unavailable.' });
      return null;
    }
    if (!response.ok) {
      res.status(401).json({ success: false, message: 'Your VantagePay session is invalid or expired.' });
      return null;
    }
    const user = await response.json().catch(() => null);
    if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) {
      res.status(401).json({ success: false, message: 'The authentication service returned an invalid user.' });
      return null;
    }
    return { user, config: c, token: match[1] };
  }

  async function rest(context, table, query, method = 'GET', body = undefined, extraHeaders = {}) {
    const url = context.config.url + '/rest/v1/' + table + (query ? '?' + query : '');
    const response = await fetchImpl(url, {
      method,
      headers: {
        apikey: context.config.serviceKey,
        Authorization: 'Bearer ' + context.config.serviceKey,
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
        'select=request_reference,request_type,amount_minor_units,currency_code,status,provider_reference,customer_note,created_at,updated_at,settled_at&user_id=eq.' + context.user.id + '&order=created_at.desc&limit=100');
      return res.json({ success: true, requests: Array.isArray(rows) ? rows : [] });
    } catch {
      return res.status(503).json({ success: false, message: 'Transaction requests are unavailable.' });
    }
  });

  app.post('/api/vantagepay/transaction-requests', async (req, res) => {
    const context = await requireUser(req, res); if (!context) return;
    const validation = validateTransactionRequest(req.body, req.get('Idempotency-Key'));
    if (!validation.valid) return res.status(400).json({ success: false, message: validation.reason });
    try {
      const input = validation.value;
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
        return res.status(409).json({ success: false, message: 'This idempotency key or request reference has already been used.' });
      }
      return res.status(503).json({ success: false, message: 'The request could not be recorded. No money was moved.' });
    }
  });
}
