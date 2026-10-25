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
          json: async () => ({ user: { id: userId } })
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
