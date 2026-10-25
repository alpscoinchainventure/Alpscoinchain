import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerVantagePayApi } from './lib/vantagepay-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

app.use(express.json({ verify(req, _res, buf) {
  if (req.originalUrl.startsWith('/api/vantagepay/webhooks/')) req.rawBody = Buffer.from(buf);
} }));
app.use(express.urlencoded({ extended: true }));

// VantagePay routes use only dedicated Neon Auth/Data API environment variables.
// Privileged webhook and admin operations remain fail-closed until a reviewed Neon server adapter exists.
registerVantagePayApi(app);
app.use(express.static(__dirname));

// VantagePay has a customer-facing homepage and separate demo/auth/dashboard routes.
app.get('/vantagepay', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-home.html')));
app.get('/vantagepay/demo', (_req, res) => res.redirect(302, '/vantagepay-preview.html'));
app.get('/vantagepay-home.html', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-home.html')));
app.get('/vantagepay/login', (_req, res) => res.redirect(302, '/vantagepay-auth.html'));
app.get('/vantagepay/dashboard', (_req, res) => res.redirect(302, '/vantagepay-dashboard.html'));
app.get('/vantagepay/admin', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-admin.html')));
app.get('/vantagepay-preview.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'vantagepay-preview.html'));
});
app.get('/vantagepay-auth.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'vantagepay-auth.html'));
});
app.get('/vantagepay-dashboard.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'vantagepay-dashboard.html'));
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendEmail({ to, subject, text, html }) {
  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || 'onboarding@resend.dev';
  const recipient = to || process.env.TO_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_USER || 'delivered@resend.dev';

  if (resend) {
    await resend.emails.send({ from: fromEmail, to: [recipient], subject, text, html });
    return;
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error('Email delivery is not configured yet. Set RESEND_API_KEY or SMTP credentials to enable sending.');
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: smtpUser, pass: smtpPass }
  });

  await transporter.sendMail({ from: fromEmail, to: recipient, subject, text, html });
}

app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const htmlMessage = `
    <h3>New contact request</h3>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
    <p><strong>Message:</strong><br/>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>
  `;

  try {
    await sendEmail({
      to: process.env.TO_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_USER || email,
      subject: `[AlpsCoinChain] ${subject}`,
      text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      html: htmlMessage
    });
    return res.json({ success: true, message: 'Message sent successfully.' });
  } catch (error) {
    console.error('Email send failed:', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to send message right now. Verify the mail provider configuration.' });
  }
});

app.post('/api/trade', async (req, res) => {
  const { clientEmail, asset, action, amount, market } = req.body;

  if (!clientEmail || !asset || !action || !amount) {
    return res.status(400).json({ success: false, message: 'Client email, asset, action, and amount are required.' });
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Please enter a valid positive amount.' });
  }

  const actionLabel = action === 'sell' ? 'Sell' : 'Buy';
  const htmlMessage = `
    <h3>${actionLabel} order placed</h3>
    <p><strong>Client:</strong> ${escapeHtml(clientEmail)}</p>
    <p><strong>Asset:</strong> ${escapeHtml(asset)}</p>
    <p><strong>Market:</strong> ${escapeHtml(market || 'N/A')}</p>
    <p><strong>Amount:</strong> ${escapeHtml(parsedAmount.toString())}</p>
    <p>Your ${actionLabel.toLowerCase()} order for ${escapeHtml(asset)} has been received.</p>
  `;

  try {
    await sendEmail({
      to: clientEmail,
      subject: `[AlpsCoinChain] ${actionLabel} order received for ${asset}`,
      text: `Hello,\n\nYour ${actionLabel.toLowerCase()} order for ${asset} has been received.\nAmount: ${parsedAmount}\nMarket: ${market || 'N/A'}`,
      html: htmlMessage
    });
    return res.json({ success: true, message: `${actionLabel} order placed successfully.` });
  } catch (error) {
    console.error('Trade notification failed:', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to send the trade notification right now.' });
  }
});

app.get('/', (req, res, next) => {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (
    host === 'vantagepay.vercel.app' ||
    /^vantagepay-.+-alpscoinchaininvestmentventures\.vercel\.app$/.test(host) ||
    [
      'vantagepay-alpscoinchaininvestmentventures.vercel.app',
      'vintagebanking.cyou',
      'www.vintagebanking.cyou'
    ].includes(host)
  ) {
    return res.sendFile(path.join(__dirname, 'vantagepay-home.html'));
  }
  return next();
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`AlpsCoinChain mail server running on port ${port}`);
});
