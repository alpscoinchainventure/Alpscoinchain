import { createHash, randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uevofmlzpwrdidjnwxfd.supabase.co';
const SUPABASE_PUBLIC_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_OLqZsWFBHY8CaTkko0-FcA_26y2jhJB';
const ACCOUNT_OFFICER_URL = 'https://t.me/Alpscoinchainaccountofficer';

function serviceKey() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Telegram integration requires SUPABASE_SERVICE_ROLE_KEY.');
  return key;
}

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram bot is not configured.');
  return token;
}

async function db(path, options = {}) {
  const key = serviceKey();
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: {
      apikey: key,
      ...(key.startsWith('sb_secret_') ? {} : { Authorization: 'Bearer ' + key }),
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) {
    console.error('Telegram database request failed:', response.status, body.slice(0, 400));
    throw new Error('The account service is temporarily unavailable.');
  }
  return body ? JSON.parse(body) : null;
}

async function telegram(method, payload) {
  const response = await fetch('https://api.telegram.org/bot' + botToken() + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    console.error('Telegram API request failed:', result.description || response.status);
    throw new Error('Telegram message could not be delivered.');
  }
  return result.result;
}

async function reply(chatId, text, extra = {}) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text: String(text).slice(0, 3900),
    disable_web_page_preview: true,
    ...extra
  });
}

function hashCode(code) {
  return createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

async function linkedAccount(chatId) {
  const rows = await db('telegram_account_links?select=user_id,notifications_enabled&chat_id=eq.' +
    encodeURIComponent(String(chatId)) + '&limit=1');
  return rows?.[0] || null;
}

async function getProfile(userId) {
  const rows = await db('profiles?select=id,full_name,role,account_status,kyc_status&id=eq.' +
    encodeURIComponent(userId) + '&limit=1');
  return rows?.[0] || null;
}

async function handleText(message) {
  const chatId = message.chat?.id;
  const text = String(message.text || '').trim();
  if (!chatId || !text) return;

  const [rawCommand, ...args] = text.split(/\s+/);
  const command = rawCommand.split('@')[0].toLowerCase();
  const argText = args.join(' ').trim();

  // Public education and onboarding commands are available before account linking.
  if (command === '/officer' || command === '/accountofficer' || command === '/referral') {
    return reply(chatId, 'AlpsCoinChain Ventures — Account Officer\nContact the account officer on Telegram: ' + ACCOUNT_OFFICER_URL + '\n\nFor safety, verify any instructions through the official website. Never share passwords, one-time codes, private keys or recovery phrases in Telegram.');
  }
  if (command === '/website' || command === '/signup') {
    return reply(chatId, 'Official website: https://www.alpscoinchaininvestment.uk/\n\nGetting started:\n1. Review the website, product information and risk disclosures.\n2. Select Sign Up: https://www.alpscoinchaininvestment.uk/signup.html\n3. Enter accurate details and complete any email confirmation.\n4. Sign in: https://www.alpscoinchaininvestment.uk/login.html\n5. Review your dashboard, fees, terms, eligibility and withdrawal conditions.\n6. Complete any required identity checks only through the secure website.\n\nCreating an account does not guarantee acceptance or returns. Never send passwords, identity documents, card details, private keys or recovery phrases in Telegram. Use /learn and /risks before deciding.');
  }

  if (command === '/learn' || command === '/beginner') {
    return reply(chatId, 'Beginner learning path\n\n1. Investing means committing money with the possibility of gain or loss. You can lose some or all of it.\n2. Forex is the exchange of one currency for another.\n3. Crypto-assets are digital assets whose prices can be highly volatile.\n4. Investment products differ in risks, fees, time horizons and withdrawal conditions.\n5. Learn how a product works before depositing. Account creation is not a commitment to invest.\n\nContinue: /forex, /crypto, /risks, /steps.');
  }

  if (command === '/forex') {
    return reply(chatId, 'Forex (foreign exchange) is the market where currencies are exchanged, for example EUR/USD. Key concepts:\n• Bid/ask spread: difference between buy and sell prices.\n• Leverage: magnifies exposure and losses as well as gains.\n• Margin: funds required to maintain a leveraged position.\n• Volatility: how quickly prices move.\n\nForex trading is high risk. Leverage can cause rapid losses, potentially exceeding the amount initially committed depending on the product and jurisdiction. This bot does not provide personal trading signals or promise profits. Read /risks and independently review product terms.');
  }

  if (command === '/crypto') {
    return reply(chatId, 'Crypto-assets are digital assets that may use blockchain networks. Prices can move sharply, liquidity can change, and transfers may be irreversible. Networks and tokens are not interchangeable.\n\nBefore transferring, verify the exact asset, network, destination address and fees using the official dashboard. Never share a seed phrase or private key. Crypto-assets are not bank deposits and may not have deposit protection. You can lose the full amount invested. Read /risks.');
  }

  if (command === '/risks') {
    return reply(chatId, 'Important investment risks\n\n• Returns and APY are not guaranteed; past performance does not predict future results.\n• Forex leverage magnifies losses.\n• Crypto-assets can be extremely volatile or become illiquid.\n• Fees, spreads, lock-ups, withdrawal conditions and counterparty risks matter.\n• Do not invest money needed for essentials or borrow to invest.\n• Beware of impersonators, guaranteed-profit claims and pressure to deposit quickly.\n\nUse https://www.alpscoinchaininvestment.uk/ and independently verify the operator, regulatory status, terms and risks relevant to your country before sending money. Educational information only, not personal financial advice.');
  }

  if (command === '/steps' || command === '/gettingstarted') {
    return reply(chatId, 'Your getting-started checklist\n\n1. Learn the basics: /learn.\n2. Explore forex: /forex.\n3. Explore crypto-assets: /crypto.\n4. Read the risks: /risks.\n5. Visit https://www.alpscoinchaininvestment.uk/.\n6. Sign up: https://www.alpscoinchaininvestment.uk/signup.html.\n7. Use your own accurate details and complete any email confirmation.\n8. Sign in: https://www.alpscoinchaininvestment.uk/login.html.\n9. Review available products, fees, terms and withdrawal conditions.\n10. Complete required verification only through the secure website.\n11. Do not deposit until you understand the product and its risks.\n\nAccount Officer: ' + ACCOUNT_OFFICER_URL + '\n\nThe bot cannot approve accounts or verify payments by chat. Use /support for help.');
  }

  if (command === '/groupintro') {
    if (!['group', 'supergroup'].includes(message.chat?.type)) return reply(chatId, 'Use /groupintro only in a group where administrators have invited this bot and approved its introduction.');
    const member = await telegram('getChatMember', { chat_id: chatId, user_id: message.from?.id });
    if (!['creator', 'administrator'].includes(member?.status)) return reply(chatId, 'Only a group owner or administrator can request the introduction.');
    return reply(chatId, 'AlpsCoinChain Investment Ventures\n\nMembers who are interested can independently review our website: https://www.alpscoinchaininvestment.uk/.\n\nNew to investing? Start with /learn, /forex, /crypto and /risks. Investments involve risk; returns are not guaranteed. Please follow this group’s promotion rules and do your own independent checks.');
  }

  if (command === '/outreach') {
    if (String(chatId) !== String(process.env.TELEGRAM_ADMIN_CHAT_ID || '')) return reply(chatId, 'This command is reserved for the AlpsCoinChain support administrator.');
    return reply(chatId, 'Admin-approved community introduction draft:\n\nHello everyone. We are sharing AlpsCoinChain Investment Ventures as a resource for people researching digital assets, forex and investment concepts. You can independently review the website and product information at https://www.alpscoinchaininvestment.uk/. Newcomers can start with our educational guides about forex, crypto-assets and investment risks. Please review all terms, fees, eligibility and risk disclosures independently. Returns are not guaranteed and this is not personal financial advice.\n\nShare only where promotion is permitted. Do not mass-DM members or post repeatedly.');
  }

  if (command === '/start') {
    return reply(chatId,
      'Welcome to AlpsCoinChain Investment Ventures! I can guide beginners through forex, crypto-assets, investment risks and account setup, as well as help existing customers.\n\nStart with /learn or /steps. Visit https://www.alpscoinchaininvestment.uk/ for official information.\n\nAccount Officer: ' + ACCOUNT_OFFICER_URL + '\nFor private account services, link your account from the signed-in dashboard. Use /help for all commands.',
      { reply_markup: { keyboard: [[{ text: '/learn' }, { text: '/forex' }], [{ text: '/steps' }, { text: '/risks' }], [{ text: '/website' }, { text: '/support' }]], resize_keyboard: true } }
    );
  }

  if (command === '/help') {
    return reply(chatId,
      'AlpsCoinChain customer assistant\n\n/start — welcome menu\n/learn — beginner learning path\n/forex — forex basics\n/crypto — crypto basics\n/risks — investment risk guide\n/steps — step-by-step signup guide\n/website — official website and signup\n/officer — contact the account officer\n/groupintro — admin-approved group introduction\n/outreach — admin-only community post draft\n\n/link CODE — securely link your signed-in account\n/account — account status\n/balance — posted ledger balances\n/history — recent ledger activity\n/plans — published investment plans\n/apy — published performance reports\n/profits — reported returns\n/deposit AMOUNT ASSET — submit a request for review\n/transaction REFERENCE — check a request reference\n/notifications — toggle notifications\n/support MESSAGE — contact support\n\n/officer — contact the AlpsCoinChain Ventures account officer\n\nNever send passwords, private keys or recovery phrases. Returns are not guaranteed.'
    );
  }

  if (command === '/link') {
    const code = (args[0] || '').toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      return reply(chatId, 'To link your account, sign in to the official client dashboard, open Telegram Account Link, generate a code and send /link followed by that code. Codes expire after 10 minutes.');
    }
    const rows = await db('telegram_link_codes?select=id,user_id,expires_at&code_hash=eq.' +
      hashCode(code) + '&used_at=is.null&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&limit=1');
    const linkCode = rows?.[0];
    if (!linkCode) return reply(chatId, 'That link code is invalid, expired or already used. Generate a new code from your signed-in dashboard.');
    const consumed = await db('telegram_link_codes?id=eq.' + encodeURIComponent(linkCode.id) + '&used_at=is.null', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ used_at: new Date().toISOString() })
    });
    if (!consumed?.length) return reply(chatId, 'That code has already been used. Generate a new code.');
    await db('telegram_account_links?on_conflict=chat_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        chat_id: String(chatId),
        telegram_user_id: String(message.from?.id || chatId),
        user_id: linkCode.user_id,
        notifications_enabled: true,
        linked_at: new Date().toISOString()
      })
    });
    return reply(chatId, 'Your Telegram chat is now linked to your AlpsCoinChain account. Private account commands are available here. Keep this Telegram account secure.');
  }

  if (command === '/plans') {
    const rows = await db('investment_plans?select=name,description,asset_code,minimum_amount,maximum_amount,duration_days,apy_rate,return_terms,risk_disclosure&status=eq.published&order=created_at.desc&limit=10');
    if (!rows?.length) return reply(chatId, 'There are currently no published investment plans available to display.');
    const output = rows.map(p => {
      const apy = p.apy_rate === null ? 'Not published' : String(p.apy_rate) + '% APY (variable; not guaranteed)';
      return p.name + ' — ' + p.asset_code + '\nMinimum: ' + p.minimum_amount +
        (p.maximum_amount === null ? '' : '\nMaximum: ' + p.maximum_amount) +
        '\nDuration: ' + p.duration_days + ' days\nAPY: ' + apy +
        '\n' + p.description + '\nRisk: ' + p.risk_disclosure;
    });
    return reply(chatId, output.join('\n\n').slice(0, 3900));
  }

  if (command === '/support') {
    if (!argText) return reply(chatId, 'Please send your question after the command, for example: /support I need help with a deposit reference.');
    const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!adminChat) return reply(chatId, 'Support messaging is not fully configured yet. Please use the support contact on the official website.');
    const account = await linkedAccount(chatId);
    const profile = account ? await getProfile(account.user_id) : null;
    const customer = profile?.full_name || (message.from?.username ? '@' + message.from.username : 'Unlinked Telegram user');
    await reply(adminChat, 'New AlpsCoinChain Telegram support request\nCustomer: ' + customer +
      '\nTelegram chat: ' + chatId + '\nMessage: ' + argText.slice(0, 2500));
    return reply(chatId, 'Your support message has been forwarded to the AlpsCoinChain support team. For direct account-officer contact: ' + ACCOUNT_OFFICER_URL + '\\nDo not include passwords, private keys or recovery phrases.');
  }

  const account = await linkedAccount(chatId);
  if (!account) return reply(chatId, 'Please link your account first. Generate a code from the signed-in client dashboard and send /link CODE.');

  const profile = await getProfile(account.user_id);
  if (!profile || profile.role !== 'client' || profile.account_status !== 'active') {
    return reply(chatId, 'Your account is not currently eligible for private Telegram account services. Please contact official support.');
  }

  if (command === '/account') {
    return reply(chatId, 'Account: ' + (profile.full_name || 'Client') +
      '\nStatus: ' + profile.account_status + '\nKYC status: ' + profile.kyc_status);
  }

  if (command === '/balance') {
    const entries = await db('ledger_entries?select=entry_type,amount,asset&user_id=eq.' +
      encodeURIComponent(account.user_id) + '&order=created_at.desc&limit=500');
    const balances = new Map();
    for (const entry of entries || []) {
      const asset = String(entry.asset).toUpperCase();
      const raw = String(entry.amount);
      const [whole = '0', fraction = ''] = raw.split('.');
      const units = BigInt(whole || '0') * 10000000000n + BigInt((fraction + '0000000000').slice(0, 10));
      const signed = entry.entry_type === 'credit' ? units : -units;
      balances.set(asset, (balances.get(asset) || 0n) + signed);
    }
    const lines = [...balances.entries()].sort((a,b) => a[0].localeCompare(b[0]))
      .map(([asset, units]) => {
        const whole = units / 10000000000n;
        const fraction = (units % 10000000000n).toString().padStart(10, '0').replace(/0+$/, '');
        return asset + ': ' + whole.toString() + (fraction ? '.' + fraction : '');
      });
    return reply(chatId, lines.length ? 'Posted ledger balances (not pending requests):\n' + lines.join('\n') : 'No posted ledger entries were found for your account.');
  }

  if (command === '/history') {
    const rows = await db('ledger_entries?select=entry_type,amount,asset,reference,created_at&user_id=eq.' +
      encodeURIComponent(account.user_id) + '&order=created_at.desc&limit=8');
    if (!rows?.length) return reply(chatId, 'No posted ledger activity was found.');
    return reply(chatId, 'Recent posted ledger entries:\n' + rows.map(x =>
      x.created_at.slice(0,10) + ' · ' + x.entry_type.toUpperCase() + ' ' + x.amount + ' ' +
      x.asset + '\nReference: ' + x.reference).join('\n\n'));
  }

  if (command === '/apy' || command === '/profits') {
    const rows = await db('apy_performance_reports?select=reporting_period_start,reporting_period_end,apy_rate,return_amount,asset_code,summary,published_at&beneficiary_user_id=eq.' +
      encodeURIComponent(account.user_id) + '&status=eq.published&order=published_at.desc&limit=8');
    if (!rows?.length) return reply(chatId, 'No published APY performance reports are currently available for your account.');
    return reply(chatId, 'Published performance reports (informational; not a guarantee):\n' +
      rows.map(x => x.reporting_period_start + ' to ' + x.reporting_period_end +
        '\nAPY: ' + (x.apy_rate ?? 'Not stated') + '%' +
        '\nReported return: ' + (x.return_amount ?? 'Not stated') + ' ' + (x.asset_code || '') +
        '\n' + x.summary).join('\n\n') +
      '\n\nImportant: reports do not change your account balance. Only posted ledger entries represent credited amounts.');
  }

  if (command === '/deposit') {
    const match = argText.match(/^([0-9]+(?:\.[0-9]{1,10})?)\s+([A-Z0-9]{2,12})$/i);
    if (!match) return reply(chatId, 'Format: /deposit AMOUNT ASSET\nExample: /deposit 100 USDT\nThis creates a request for administrator review; it does not confirm receipt or credit funds.');
    const amount = Number(match[1]);
    const asset = match[2].toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0) return reply(chatId, 'Enter a valid amount greater than zero.');
    const rows = await db('fund_requests', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: account.user_id, request_type: 'deposit', amount, asset })
    });
    const request = rows?.[0];
    return reply(chatId, request
      ? 'Deposit request recorded for administrator review.\nReference: ' + request.reference +
        '\nStatus: ' + request.status + '\nThis is not confirmation that funds were received or credited.'
      : 'Your request could not be recorded. Please try again later.');
  }

  if (command === '/transaction' || command === '/reference') {
    if (!argText) return reply(chatId, 'Send /transaction followed by your request reference.');
    const rows = await db('fund_requests?select=request_type,amount,asset,status,reference,created_at&user_id=eq.' +
      encodeURIComponent(account.user_id) + '&reference=eq.' + encodeURIComponent(argText) + '&limit=1');
    const request = rows?.[0];
    return reply(chatId, request
      ? 'Request: ' + request.request_type + '\nAmount: ' + request.amount + ' ' + request.asset +
        '\nStatus: ' + request.status + '\nReference: ' + request.reference +
        '\nSubmitted: ' + request.created_at
      : 'No request with that reference was found on your linked account.');
  }

  if (command === '/notifications') {
    const next = !account.notifications_enabled;
    await db('telegram_account_links?chat_id=eq.' + encodeURIComponent(String(chatId)), {
      method: 'PATCH',
      body: JSON.stringify({ notifications_enabled: next })
    });
    return reply(chatId, 'Telegram account notifications are now ' + (next ? 'enabled.' : 'disabled.'));
  }

  if (command === '/withdraw') {
    return reply(chatId, 'For security, withdrawals must be submitted through the signed-in AlpsCoinChain dashboard using a saved beneficiary. Open https://www.alpscoinchaininvestment.uk/fund-requests.html. This bot will not collect bank passwords, card PINs, private keys or recovery phrases.');
  }

  return reply(chatId, 'I did not recognize that command. Send /help to see available options.');
}

export function registerTelegramRoutes(app) {
  app.post('/api/telegram/link-code', async (req, res) => {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ success: false, message: 'Sign in to your AlpsCoinChain account first.' });
    try {
      const auth = await fetch(SUPABASE_URL + '/auth/v1/user', {
        headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: 'Bearer ' + match[1] }
      });
      if (!auth.ok) return res.status(401).json({ success: false, message: 'Your session is invalid or expired. Sign in again.' });
      const user = await auth.json();
      const profiles = await db('profiles?select=id,role,account_status&id=eq.' + encodeURIComponent(user.id) + '&limit=1');
      const profile = profiles?.[0];
      if (!profile || profile.role !== 'client' || profile.account_status !== 'active') {
        return res.status(403).json({ success: false, message: 'Only active client accounts can be linked.' });
      }
      const code = randomBytes(5).toString('hex').slice(0,8).toUpperCase();
      await db('telegram_link_codes?user_id=eq.' + encodeURIComponent(user.id) + '&used_at=is.null', {
        method: 'PATCH', body: JSON.stringify({ used_at: new Date().toISOString() })
      });
      await db('telegram_link_codes', {
        method: 'POST',
        body: JSON.stringify({
          user_id: user.id,
          code_hash: hashCode(code),
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })
      });
      return res.json({ success: true, code, expires_in_seconds: 600, bot_username: 'Alpscoinchaininvest_Bot' });
    } catch (error) {
      console.error('Telegram link-code creation failed:', error.message);
      return res.status(503).json({ success: false, message: 'Telegram account linking is not configured yet.' });
    }
  });

  app.post('/api/telegram/webhook', async (req, res) => {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    const provided = req.get('x-telegram-bot-api-secret-token') || '';
    if (!expected || provided !== expected) return res.status(401).json({ ok: false });
    // Acknowledge quickly; Vercel must keep the request alive while processing.
    try {
      const update = req.body || {};
      if (update.message?.text) await handleText(update.message);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Telegram update failed:', error.message);
      return res.status(200).json({ ok: true });
    }
  });
}

export async function sendTelegramAccountNotification(userId, event) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) return;
  try {
    const links = await db('telegram_account_links?select=chat_id,notifications_enabled&user_id=eq.' +
      encodeURIComponent(userId) + '&limit=1');
    const link = links?.[0];
    if (!link || !link.notifications_enabled) return;
    await reply(link.chat_id, 'AlpsCoinChain account update\n' +
      String(event.title || 'Account activity').slice(0, 150) + '\n' +
      String(event.summary || 'There is a new update to your account.').slice(0, 1200) +
      '\n\nSign in to your dashboard for details. This message does not itself confirm a payment or transfer.');
  } catch (error) {
    console.error('Telegram account notification failed:', error.message);
  }
}
