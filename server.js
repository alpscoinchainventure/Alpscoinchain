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

// Parse incoming request bodies.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the dashboard directly before static-file middleware.
// Disable browser caching while diagnosing the blank dashboard.
app.get('/client-dashboard.html', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  res.sendFile(path.join(__dirname, 'client-dashboard.html'));
});

// Serve other static files without automatically serving index.html.
app.use(express.static(__dirname, {
  index: false
}));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendEmail({ to, subject, text, html }) {
  const fromEmail =
    process.env.FROM_EMAIL ||
    process.env.SMTP_USER ||
    'onboarding@resend.dev';

  const recipient =
    to ||
    process.env.TO_EMAIL ||
    process.env.FROM_EMAIL ||
    process.env.SMTP_USER ||
    'delivered@resend.dev';

  // Use Resend when an API key is configured.
  if (resend) {
    await resend.emails.send({
      from: fromEmail,
      to: [recipient],
      subject,
      text,
      html
    });
    return;
  }

  // Otherwise, use the configured SMTP provider.
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error(
      'Email delivery is not configured yet. Set RESEND_API_KEY or SMTP credentials to enable sending.'
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
    to: recipient,
    subject,
    text,
    html
  });
}

/*
 * Temporary diagnostic route.
 * Checks whether the server can return visible HTML.
 */
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
 * Contact form email endpoint.
 */
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required.'
    });
  }

  const htmlMessage = `
    <h3>New contact request</h3>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
    <p><strong>Message:</strong><br/>
      ${escapeHtml(message).replace(/\n/g, '<br/>')}
    </p>
  `;

  try {
    await sendEmail({
      to:
        process.env.TO_EMAIL ||
        process.env.FROM_EMAIL ||
        process.env.SMTP_USER ||
        email,
      subject: `[AlpsCoinChain] ${subject}`,
      text:
        `Name: ${name}\n` +
        `Email: ${email}\n\n` +
        `Message:\n${message}`,
      html: htmlMessage
    });

    return res.json({
      success: true,
      message: 'Message sent successfully.'
    });
  } catch (error) {
    console.error('Email send failed:', error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to send message right now. Verify the mail provider configuration.'
    });
  }
});

/*
 * Trade notification endpoint.
 */
app.post('/api/trade', async (req, res) => {
  const {
    clientEmail,
    asset,
    action,
    amount,
    market
  } = req.body;

  if (!clientEmail || !asset || !action || !amount) {
    return res.status(400).json({
      success: false,
      message:
        'Client email, asset, action, and amount are required.'
    });
  }

  const parsedAmount = Number(amount);

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Please enter a valid positive amount.'
    });
  }

  const actionLabel = action === 'sell' ? 'Sell' : 'Buy';

  const htmlMessage = `
    <h3>${actionLabel} order placed</h3>
    <p><strong>Client:</strong> ${escapeHtml(clientEmail)}</p>
    <p><strong>Asset:</strong> ${escapeHtml(asset)}</p>
    <p><strong>Market:</strong> ${escapeHtml(market || 'N/A')}</p>
    <p><strong>Amount:</strong> ${escapeHtml(parsedAmount.toString())}</p>
    <p>
      Your ${actionLabel.toLowerCase()} order for
      ${escapeHtml(asset)} has been received.
    </p>
  `;

  try {
    await sendEmail({
      to: clientEmail,
      subject:
        `[AlpsCoinChain] ${actionLabel} order received for ${asset}`,
      text:
        `Hello,\n\n` +
        `Your ${actionLabel.toLowerCase()} order for ${asset} has been received.\n` +
        `Amount: ${parsedAmount}\n` +
        `Market: ${market || 'N/A'}`,
      html: htmlMessage
    });

    return res.json({
      success: true,
      message: `${actionLabel} order placed successfully.`
    });
  } catch (error) {
    console.error('Trade notification failed:', error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Unable to send the trade notification right now.'
    });
  }
});

/*
 * Login page.
 */
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

/*
 * Dashboard route.
 * The earlier no-cache route handles dashboard requests first.
 */
app.get('/client-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'client-dashboard.html'));
});

/*
 * Password-reset page.
 */
app.get('/reset-password.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'reset-password.html'));
});

/*
 * Main website.
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/*
 * Fallback for other routes.
 */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`AlpsCoinChain mail server running on port ${port}`);
});
