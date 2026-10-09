import 'dotenv/config';
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

// Login page.
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
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

app.listen(port, () => {
  console.log('AlpsCoinChain server listening on port ' + port);
});
