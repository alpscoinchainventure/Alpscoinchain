import test from 'node:test';
import assert from 'node:assert/strict';
import { registerVantagePayApi } from '../lib/vantagepay-api.js';

function makeApp() {
  const handlers = new Map();
  return {
    handlers,
    get(path, fn) { handlers.set('GET ' + path, fn); },
    post(path, fn) { handlers.set('POST ' + path, fn); },
    patch(path, fn) { handlers.set('PATCH ' + path, fn); }
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('VantagePay config exposes only Neon public endpoints', async () => {
  const app = makeApp();
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1'
    },
    fetchImpl: async () => { throw new Error('fetch should not be called'); }
  });
  const res = makeResponse();
  await app.handlers.get('GET /api/vantagepay/config')({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.neonDataApiUrl, 'https://data.example.test/neondb/rest/v1');
  assert.equal('serviceKey' in res.payload, false);
});

test('customer account query uses the user JWT against Neon Data API', async () => {
  const app = makeApp();
  const calls = [];
  const userId = 'c3a9f4a1-1a9b-4b6e-8d10-8fd2c5d3b1a2';
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1'
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).endsWith('/get-session')) {
        return {
          ok: true,
          json: async () => ({ user: { id: userId, emailVerified: true } })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{
          user_id: userId,
          account_reference: 'VP-TEST',
          display_name: 'Test Customer',
          account_status: 'pending'
        }])
      };
    }
  });
  const res = makeResponse();
  await app.handlers.get('GET /api/vantagepay/account')({
    headers: { authorization: 'Bearer customer-jwt' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.account.user_id, userId);
  const dataCall = calls.find(call => String(call.url).includes('/vp_customer_accounts?'));
  assert.ok(dataCall, 'expected a Neon Data API request');
  assert.equal(dataCall.options.headers.Authorization, 'Bearer customer-jwt');
  assert.equal('apikey' in dataCall.options.headers, false);
  assert.equal(String(dataCall.url).startsWith('https://data.example.test/neondb/rest/v1/'), true);
});

test('unverified Neon Auth sessions are denied before any customer data query', async () => {
  const app = makeApp();
  const calls = [];
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1'
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/get-session')) {
        return { ok: true, json: async () => ({ user: {
          id: 'c3a9f4a1-1a9b-4b6e-8d10-8fd2c5d3b1a2',
          emailVerified: false
        } }) };
      }
      throw new Error('unverified user must not query customer data');
    }
  });
  const res = makeResponse();
  await app.handlers.get('GET /api/vantagepay/account')({
    headers: { authorization: 'Bearer unverified-jwt' }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, 'VANTAGEPAY_EMAIL_VERIFICATION_REQUIRED');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith('/get-session'));
});

test('customer account query rejects missing session before touching the data API', async () => {
  const app = makeApp();
  const calls = [];
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1'
    },
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ user: { id: 'c3a9f4a1-1a9b-4b6e-8d10-8fd2c5d3b1a2' } }) };
    }
  });
  const res = makeResponse();
  await app.handlers.get('GET /api/vantagepay/account')({ headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
});


test('invalid or expired Neon session is rejected before querying customer data', async () => {
  const app = makeApp();
  const calls = [];
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1'
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      return { ok: false, status: 401, json: async () => ({}) };
    }
  });
  const res = makeResponse();
  await app.handlers.get('GET /api/vantagepay/account')({
    headers: { authorization: 'Bearer expired-jwt' }
  }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith('/get-session'));
  assert.equal(calls.some(url => url.includes('/vp_customer_accounts?')), false);
});

test('privileged webhook remains disabled even when webhook credentials are supplied', async () => {
  const app = makeApp();
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1',
      VANTAGEPAY_APY_WEBHOOK_SECRET: 'x'.repeat(40),
      VANTAGEPAY_APY_PROVIDER_CODE: 'sandbox-provider'
    },
    fetchImpl: async () => { throw new Error('disabled webhook must not access the data API'); }
  });
  const res = makeResponse();
  await app.handlers.get('POST /api/vantagepay/webhooks/apy')({
    body: {},
    rawBody: Buffer.from('{}'),
    headers: {},
    get() { return ''; }
  }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.success, false);
});

test('admin operation rejects unauthenticated requests', async () => {
  const app = makeApp();
  const calls = [];
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1'
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      throw new Error('unexpected network call');
    }
  });
  const res = makeResponse();
  await app.handlers.get('GET /api/vantagepay/admin/transaction-requests')({
    headers: {}
  }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
});


test('admin request queue uses the SQL RPC after checking the signed-in admin membership', async () => {
  const app = makeApp();
  const calls = [];
  const userId = 'c3a9f4a1-1a9b-4b6e-8d10-8fd2c5d3b1a2';
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1'
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/get-session')) {
        return { ok: true, json: async () => ({ user: { id: userId, emailVerified: true } }) };
      }
      if (String(url).includes('/vp_admin_memberships?')) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ admin_role: 'operations', enabled: true }]) };
      }
      if (String(url).endsWith('/rpc/vp_admin_list_transaction_requests')) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'request-row' }]) };
      }
      throw new Error('unexpected API call: ' + url);
    }
  });

  const res = makeResponse();
  await app.handlers.get('GET /api/vantagepay/admin/transaction-requests')({
    headers: { authorization: 'Bearer admin-jwt' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.deepEqual(res.payload.requests, [{ id: 'request-row' }]);
  const rpcCall = calls.find(call => call.url.endsWith('/rpc/vp_admin_list_transaction_requests'));
  assert.ok(rpcCall, 'expected the cross-customer queue to use the SQL RPC');
  assert.equal(rpcCall.options.method, 'POST');
  assert.equal(rpcCall.options.headers.Authorization, 'Bearer admin-jwt');
  assert.deepEqual(JSON.parse(rpcCall.options.body), { p_actor_user_id: userId });
});


test('admin status change is delegated to the audited SQL RPC and never writes request rows directly', async () => {
  const app = makeApp();
  const calls = [];
  const userId = 'c3a9f4a1-1a9b-4b6e-8d10-8fd2c5d3b1a2';
  const requestId = 'd4b0a5b2-2b9c-4c7f-9e11-9fd3c6e4b2a3';
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1'
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/get-session')) {
        return { ok: true, json: async () => ({ user: { id: userId, emailVerified: true } }) };
      }
      if (String(url).includes('/vp_admin_memberships?')) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ admin_role: 'finance', enabled: true }]) };
      }
      if (String(url).endsWith('/rpc/vp_admin_update_request_status')) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ id: requestId, status: 'under_review' })
        };
      }
      throw new Error('unexpected API call: ' + url);
    }
  });

  const res = makeResponse();
  await app.handlers.get('PATCH /api/vantagepay/admin/transaction-requests/:id/status')({
    headers: { authorization: 'Bearer admin-jwt' },
    params: { id: requestId },
    body: { status: 'under_review', reason: 'Review supporting request documents' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.request.status, 'under_review');
  const rpcCall = calls.find(call => call.url.endsWith('/rpc/vp_admin_update_request_status'));
  assert.ok(rpcCall, 'expected the audited status SQL RPC');
  assert.equal(rpcCall.options.method, 'POST');
  assert.deepEqual(JSON.parse(rpcCall.options.body), {
    p_actor_user_id: userId,
    p_request_id: requestId,
    p_next_status: 'under_review',
    p_reason: 'Review supporting request documents'
  });
  assert.equal(calls.some(call => call.url.includes('/vp_transaction_requests?') && call.options.method === 'PATCH'), false);
});

test('balance adjustment remains explicitly disabled and does not call the data API', async () => {
  const app = makeApp();
  const calls = [];
  const userId = 'c3a9f4a1-1a9b-4b6e-8d10-8fd2c5d3b1a2';
  registerVantagePayApi(app, {
    env: {
      VANTAGEPAY_NEON_AUTH_URL: 'https://auth.example.test/neondb/auth',
      VANTAGEPAY_NEON_DATA_API_URL: 'https://data.example.test/neondb/rest/v1'
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/get-session')) {
        return { ok: true, json: async () => ({ user: { id: userId, emailVerified: true } }) };
      }
      throw new Error('balance endpoint must not access the data API');
    }
  });
  const res = makeResponse();
  await app.handlers.get('POST /api/vantagepay/admin/balance-adjustments')({
    headers: { authorization: 'Bearer customer-jwt' },
    body: { user_id: userId, amount_minor_units: '10000', currency_code: 'GBP' }
  }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.code, 'VANTAGEPAY_LEDGER_MODEL_NOT_REVIEWED');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith('/get-session'));
});
