import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: true, limit: '20kb' }));

// Prevent stale HTML pages from being reused after production design updates.
// This covers the homepage and all .html routes, including sign-in and sign-up.
app.use((req, res, next) => {
  if (req.path === '/' || /\\.html?$/i.test(req.path)) {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      Pragma: 'no-cache',
      Expires: '0'
    });
  }
  next();
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getFromEmail() {
  return (
    process.env.FROM_EMAIL ||
    process.env.SMTP_USER ||
    'onboarding@resend.dev'
  );
}

function getSupportRecipient() {
  return (
    process.env.TO_EMAIL ||
    process.env.FROM_EMAIL ||
    process.env.SMTP_USER ||
    ''
  );
}

// Monday-Friday, 08:00-18:00 UK local time.
// Europe/London automatically handles GMT and BST.
function isWithinSupportHours(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    .includes(values.weekday);

  const minutes =
    Number(values.hour) * 60 + Number(values.minute);

  return weekday && minutes >= 480 && minutes < 1080;
}

// Build an automatic acknowledgment for the customer.
function buildAcknowledgment(subject) {
  const duringBusinessHours = isWithinSupportHours();

  const message = duringBusinessHours
    ? 'Thank you for contacting AlpsCoinChain Investment Ventures. We have received your support request during our business hours. Our support team will review your enquiry as soon as possible.'
    : 'Thank you for contacting AlpsCoinChain Investment Ventures. We have received your support request outside our business hours. Our support team operates Monday to Friday, 08:00-18:00 UK time, and will review your request during the next business period.';

  const text =
    'Hello,\n\n' +
    message +
    '\n\nYour subject: ' + subject +
    '\n\nThis is an automatic acknowledgment, not a personal response. If you need to add information, you can reply to this email.\n\n' +
    'Kind regards,\n' +
    'AlpsCoinChain Investment Ventures\n' +
    'Support Team';

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <p>Hello,</p>
      <p>${escapeHtml(message)}</p>
      <p><strong>Your subject:</strong> ${escapeHtml(subject)}</p>
      <p>This is an automatic acknowledgment, not a personal response.
      If you need to add information, you can reply to this email.</p>
      <p>Kind regards,<br>
      AlpsCoinChain Investment Ventures<br>
      Support Team</p>
    </div>
  `;

  return {
    subject: 'We received your support request: ' + subject,
    text,
    html
  };
}

async function sendEmail({
  to,
  subject,
  text,
  html,
  replyTo
}) {
  if (!to) {
    throw new Error(
      'Support email recipient is not configured. Set TO_EMAIL in the deployment environment.'
    );
  }

  const fromEmail = getFromEmail();

  if (resend) {
    const result = await resend.emails.send({
      from: fromEmail,
      to: [to],
      ...(replyTo ? { replyTo } : {}),
      subject,
      text,
      html
    });

    if (result?.error) {
      console.error('Resend rejected the email:', result.error);
      throw new Error('The email provider could not send your message.');
    }

    return;
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error(
      'Email delivery is not configured. Configure Resend or SMTP credentials in the deployment environment.'
    );
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  await transporter.sendMail({
    from: fromEmail,
    to,
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    html
  });
}


const notificationWebhookSecret = process.env.ALPS_NOTIFICATION_WEBHOOK_SECRET || '';
const notificationSupabaseUrl = 'https://uevofmlzpwrdidjnwxfd.supabase.co';
const notificationSupabasePublicKey = 'sb_publishable_OLqZsWFBHY8CaTkko0-FcA_26y2jhJB';
const notificationTestLastSent = new Map();

function safeSecretMatch(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function notificationMetadataLines(metadata = {}) {
  const allowed = [
    ['request_type', 'Request type'],
    ['amount', 'Amount'],
    ['asset', 'Asset'],
    ['reference', 'Reference'],
    ['status', 'Status'],
    ['account_status', 'Account status'],
    ['period_start', 'Report period start'],
    ['period_end', 'Report period end'],
    ['apy_rate', 'APY rate'],
    ['return_amount', 'Reported return'],
    ['asset_code', 'Asset'],
    ['entry_type', 'Entry type'],
    ['description', 'Description'],
    ['action', 'Action']
  ];
  return allowed
    .filter(([key]) => metadata && metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '')
    .map(([key, label]) => [label, String(metadata[key]).slice(0, 180)]);
}

function buildAccountNotificationEmail({ title, summary, metadata = {} }) {
  const details = notificationMetadataLines(metadata);
  const detailText = details.map(([label, value]) => label + ': ' + value).join('\n');
  const detailHtml = details.length
    ? '<table role="presentation" style="width:100%;border-collapse:collapse;margin:18px 0">' +
      details.map(([label, value]) =>
        '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#64748b">' +
        escapeHtml(label) + '</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#0f172a;font-weight:600">' +
        escapeHtml(value) + '</td></tr>'
      ).join('') + '</table>'
    : '';
  const safeTitle = String(title || 'Account activity notice').slice(0, 160);
  const safeSummary = String(summary || 'There has been an update to your account.').slice(0, 1000);
  return {
    subject: '[AlpsCoinChain] ' + safeTitle,
    text:
      'Hello,\n\n' + safeSummary + '\n\n' +
      (detailText ? detailText + '\n\n' : '') +
      'Sign in to your account dashboard to review this activity. If you did not expect this change, contact support through the official website.\n\n' +
      'AlpsCoinChain Investment Ventures',
    html:
      '<div style="font-family:Arial,sans-serif;line-height:1.65;color:#0f172a;max-width:640px;margin:auto">' +
      '<div style="background:#102b50;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0"><strong>AlpsCoinChain Investment Ventures</strong></div>' +
      '<div style="border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 12px 12px">' +
      '<h2 style="margin:0 0 14px;color:#102b50">' + escapeHtml(safeTitle) + '</h2>' +
      '<p>' + escapeHtml(safeSummary) + '</p>' + detailHtml +
      '<p><a href="https://alpscoinchaininvestment.uk/client-dashboard.html" style="display:inline-block;background:#1d65d8;color:#fff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open your dashboard</a></p>' +
      '<p style="font-size:12px;color:#64748b">If you did not expect this change, contact support through the official website. This is an automated account notice.</p>' +
      '<p>Kind regards,<br>AlpsCoinChain Investment Ventures</p></div></div>'
  };
}

/*
 * Internal event endpoint. The database calls this asynchronously through pg_net.
 * It accepts only server-generated events authenticated with a separate secret.
 * Email failures are logged and never change the originating database transaction.
 */
app.post('/api/notifications/event', async (req, res) => {
  if (!safeSecretMatch(req.get('x-alps-notification-secret'), notificationWebhookSecret)) {
    return res.status(401).json({ success: false, message: 'Unauthorized notification event.' });
  }

  const event = req.body || {};
  const recipient = String(event.to || '').trim();
  const allowedTypes = new Set([
    'deposit_request_received', 'withdrawal_request_received', 'fund_request_status',
    'account_status_changed', 'profile_updated', 'beneficiary_insert',
    'beneficiary_update', 'beneficiary_delete', 'apy_report_published',
    'ledger_entry_posted'
  ]);

  if (!allowedTypes.has(String(event.event_type || '')) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ||
      recipient.length > 254 ||
      !event.notification_id) {
    return res.status(400).json({ success: false, message: 'Invalid notification event.' });
  }

  try {
    const email = buildAccountNotificationEmail({
      title: event.title,
      summary: event.summary,
      metadata: event.metadata
    });
    await sendEmail({ to: recipient, ...email });
    return res.status(200).json({ success: true, notification_id: event.notification_id });
  } catch (error) {
    console.error('Account notification delivery failed:', {
      notificationId: String(event.notification_id).slice(0, 80),
      eventType: String(event.event_type).slice(0, 80),
      message: error?.message || 'email delivery failed'
    });
    return res.status(502).json({ success: false, message: 'Notification email delivery failed.' });
  }
});

/*
 * Signed-in user self-test. The recipient is derived from Supabase Auth, never
 * from request JSON, so this endpoint cannot be used to send mail to other people.
 */
app.post('/api/notifications/test', async (req, res) => {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ success: false, message: 'Please sign in before testing email notifications.' });
  }

  try {
    const authResponse = await fetch(notificationSupabaseUrl + '/auth/v1/user', {
      headers: {
        apikey: notificationSupabasePublicKey,
        Authorization: 'Bearer ' + match[1],
        accept: 'application/json'
      }
    });
    if (!authResponse.ok) {
      return res.status(401).json({ success: false, message: 'Your sign-in session is invalid or expired. Please sign in again.' });
    }
    const user = await authResponse.json();
    const recipient = String(user?.email || '').trim();
    if (!user?.id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(400).json({ success: false, message: 'No valid email address is attached to this account.' });
    }

    const now = Date.now();
    const previous = notificationTestLastSent.get(user.id) || 0;
    if (now - previous < 60000) {
      return res.status(429).json({ success: false, message: 'Please wait one minute before sending another test email.' });
    }
    notificationTestLastSent.set(user.id, now);

    const email = buildAccountNotificationEmail({
      title: 'Email notifications are working',
      summary: 'This is a test message sent to the email address on your signed-in AlpsCoinChain account. You will receive similar notices for supported account activities.',
      metadata: { action: 'Email delivery test', status: 'Test only' }
    });
    await sendEmail({ to: recipient, ...email });
    return res.status(200).json({ success: true, message: 'Test email accepted for delivery to ' + recipient + '.' });
  } catch (error) {
    console.error('Account notification self-test failed:', error?.message || 'email delivery failed');
    return res.status(502).json({ success: false, message: 'The test email could not be sent right now. Please try again later.' });
  }
});

// Public read-only market-data proxy. CoinGecko is used for REST data because Binance REST
// endpoints can be unreachable from some hosting regions/networks. Restrict query inputs.
const allowedMarketAssets = new Set([
  'bitcoin', 'ethereum', 'binancecoin', 'solana', 'ripple', 'usd-coin', 'dogecoin'
]);
const coinGeckoBase = 'https://api.coingecko.com/api/v3';

async function fetchCoinGecko(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const upstream = await fetch(coinGeckoBase + path, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 503;
      const error = new Error(status === 429
        ? 'Public market-data rate limit reached. Please wait and retry.'
        : 'The public market-data provider is temporarily unavailable. Please retry shortly.');
      error.status = status;
      throw error;
    }
    return await upstream.json();
  } finally {
    clearTimeout(timeout);
  }
}

function sendMarketError(res, error) {
  const status = error?.status === 429 ? 429 : 503;
  return res.status(status).json({
    error: error?.message || 'The public market-data provider is temporarily unavailable. Please retry shortly.'
  });
}

app.get('/api/market/ticker-24hr', async (_req, res) => {
  try {
    const ids = [...allowedMarketAssets].join(',');
    const query = new URLSearchParams({
      vs_currency: 'usd',
      ids,
      price_change_percentage: '24h'
    });
    const data = await fetchCoinGecko('/coins/markets?' + query.toString());
    res.set({
      'Cache-Control': 'public, max-age=20, stale-while-revalidate=20',
      'CDN-Cache-Control': 'public, max-age=20',
      'Vercel-CDN-Cache-Control': 'public, max-age=20'
    });
    return res.status(200).json(data);
  } catch (error) {
    return sendMarketError(res, error);
  }
});

app.get('/api/market/ohlc', async (req, res) => {
  const id = String(req.query.id || '').toLowerCase();
  const days = String(req.query.days || '1');
  if (!allowedMarketAssets.has(id) || days !== '1') {
    return res.status(400).json({ error: 'Invalid market chart request.' });
  }
  try {
    const query = new URLSearchParams({ vs_currency: 'usd', days: '1' });
    const data = await fetchCoinGecko('/coins/' + encodeURIComponent(id) + '/ohlc?' + query.toString());
    res.set({
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=30',
      'CDN-Cache-Control': 'public, max-age=30',
      'Vercel-CDN-Cache-Control': 'public, max-age=30'
    });
    return res.status(200).json(data);
  } catch (error) {
    return sendMarketError(res, error);
  }
});

// Client dashboard: disable browser caching.
app.get('/client-dashboard.html', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  });

  res.sendFile(path.join(__dirname, 'client-dashboard.html'));
});

// Admin dashboard: disable browser caching.
app.get('/admin-dashboard.html', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  });

  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// Fund request review page: disable browser caching.
app.get('/fund-request-admin.html', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  });

  res.sendFile(path.join(__dirname, 'fund-request-admin.html'));
});

// Fund request page: always serve the latest form without stale browser/CDN caching.
app.get('/fund-requests.html', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0'
  });
  res.sendFile(path.join(__dirname, 'fund-requests.html'));
});

// Serve static files without automatically serving index.html.
app.use(express.static(__dirname, { index: false }));

// Temporary diagnostic route.
app.get('/dashboard-test', (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.status(200).type('html').send(
    '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Dashboard Test</title>' +
    '</head>' +
    '<body style="font-family:Arial,sans-serif;padding:30px;color:#142b4a">' +
    '<h1>AlpsCoinChain Test Page Works</h1>' +
    '<p>The server is returning HTML correctly.</p>' +
    '</body>' +
    '</html>'
  );
});

/*
 * Support contact endpoint.
 * 1. Send the support request to the support inbox.
 * 2. Set Reply-To to the customer's email.
 * 3. Send an automatic acknowledgment to the customer.
 */
app.post('/api/contact', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();

  if (!name || !email || !subject || !message) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, subject, and message are required.'
    });
  }

  if (
    name.length > 200 ||
    email.length > 254 ||
    subject.length > 150 ||
    message.length > 3000
  ) {
    return res.status(400).json({
      success: false,
      message: 'One or more fields exceed the allowed length.'
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid email address.'
    });
  }

  const recipient = getSupportRecipient();

  if (!recipient) {
    return res.status(503).json({
      success: false,
      message: 'Support email is not configured yet.'
    });
  }

  const htmlMessage = `
    <h2>New AlpsCoinChain support request</h2>
    <p><strong>Account:</strong> ${escapeHtml(name)}</p>
    <p><strong>Reply email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
  `;

  // First, deliver the original request to the support mailbox.
  try {
    await sendEmail({
      to: recipient,
      replyTo: email,
      subject: '[AlpsCoinChain Support] ' + subject,
      text:
        'Account: ' + name + '\n' +
        'Reply email: ' + email + '\n' +
        'Subject: ' + subject + '\n\n' +
        'Message:\n' + message,
      html: htmlMessage
    });
  } catch (error) {
    console.error('Support email delivery failed:', error);

    return res.status(502).json({
      success: false,
      message:
        'Your message could not be sent. Please try again later or contact support through the official support channel.'
    });
  }

  // Acknowledgment failure must not undo successful support delivery.
  try {
    const acknowledgment = buildAcknowledgment(subject);

    await sendEmail({
      to: email,
      replyTo: recipient,
      ...acknowledgment
    });

    return res.status(200).json({
      success: true,
      message:
        'Your support request was received, and an acknowledgment email was accepted by the email provider.'
    });
  } catch (error) {
    console.error('Support acknowledgment email failed:', error);

    return res.status(200).json({
      success: true,
      message:
        'Your support request was received, but we could not send the automatic acknowledgment email.'
    });
  }
});

/*
 * Trade notification endpoint.
 * This sends an email notification only; it does not execute trades.
 */
app.post('/api/trade', async (req, res) => {
  const {
    clientEmail,
    asset,
    action,
    amount,
    market
  } = req.body || {};

  if (!clientEmail || !asset || !action || amount === undefined) {
    return res.status(400).json({
      success: false,
      message: 'Client email, asset, action, and amount are required.'
    });
  }

  const parsedAmount = Number(amount);

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Please enter a valid positive amount.'
    });
  }

  if (!['buy', 'sell'].includes(String(action).toLowerCase())) {
    return res.status(400).json({
      success: false,
      message: 'Action must be buy or sell.'
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(clientEmail))) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid client email address.'
    });
  }

  const actionLabel =
    String(action).toLowerCase() === 'sell' ? 'Sell' : 'Buy';

  const htmlMessage = `
    <h3>${actionLabel} order notification</h3>
    <p><strong>Client:</strong> ${escapeHtml(clientEmail)}</p>
    <p><strong>Asset:</strong> ${escapeHtml(asset)}</p>
    <p><strong>Market:</strong> ${escapeHtml(market || 'N/A')}</p>
    <p><strong>Amount:</strong> ${escapeHtml(parsedAmount.toString())}</p>
    <p>This is a notification only; it does not confirm trade execution.</p>
  `;

  try {
    await sendEmail({
      to: String(clientEmail),
      subject:
        '[AlpsCoinChain] ' + actionLabel +
        ' order notification for ' + String(asset).slice(0, 100),
      text:
        'Client: ' + clientEmail + '\n' +
        'Action: ' + actionLabel + '\n' +
        'Asset: ' + asset + '\n' +
        'Amount: ' + parsedAmount + '\n' +
        'Market: ' + (market || 'N/A') + '\n\n' +
        'This is a notification only; it does not confirm trade execution.',
      html: htmlMessage
    });

    return res.json({
      success: true,
      message:
        actionLabel +
        ' notification email was accepted by the email provider.'
    });
  } catch (error) {
    console.error('Trade notification failed:', error);

    return res.status(502).json({
      success: false,
      message: 'Unable to send the trade notification right now.'
    });
  }
});

// Authentication pages: prevent browsers and intermediary caches from serving stale designs.
const authPageHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store'
};

app.get('/login.html', (req, res) => {
  res.set(authPageHeaders);
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup.html', (req, res) => {
  res.set(authPageHeaders);
  res.sendFile(path.join(__dirname, 'signup.html'));
});

// Password-reset page.
app.get('/reset-password.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'reset-password.html'));
});

// Main website.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback for other routes.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Vercel imports this Express app as a serverless handler; local development uses app.listen().
export default app;
if (process.env.VERCEL !== '1') {
  app.listen(port, () => console.log('AlpsCoinChain server listening on port ' + port));
}
