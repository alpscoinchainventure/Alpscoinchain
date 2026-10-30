import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerVantagePayApi } from './lib/vantagepay-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ verify(req, _res, buf) {
  if (req.originalUrl.startsWith('/api/vantagepay/webhooks/')) req.rawBody = Buffer.from(buf);
} }));
app.use(express.urlencoded({ extended: true }));

// Only VantagePay routes are mounted in this dedicated Vercel project.
// AlpsCoinChain legacy pages, APIs, static files and email handlers are not served here.
registerVantagePayApi(app);

app.get('/vantagepay/demo', (_req, res) => res.redirect(302, '/vantagepay/login'));
app.get('/vantagepay-preview.html', (_req, res) => res.redirect(302, '/vantagepay/login'));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-home.html')));
app.get('/vantagepay', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-home.html')));
app.get('/vantagepay-home.html', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-home.html')));
app.get('/vantagepay/login', (_req, res) => res.redirect(302, '/vantagepay-auth.html'));
app.get('/vantagepay/dashboard', (_req, res) => res.redirect(302, '/vantagepay-dashboard.html'));
app.get('/vantagepay/admin', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-admin.html')));
app.get('/vantagepay-admin.html', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-admin.html')));
app.get('/vantagepay-auth.html', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-auth.html')));
app.get('/vantagepay-dashboard.html', (_req, res) => res.sendFile(path.join(__dirname, 'vantagepay-dashboard.html')));

// Unknown VantagePay API routes return JSON, never an unrelated HTML document.
app.use('/api/vantagepay', (_req, res) => res.status(404).set('Cache-Control', 'no-store').json({
  success: false,
  code: 'VANTAGEPAY_API_ROUTE_NOT_FOUND',
  message: 'This VantagePay API endpoint is not available.'
}));
app.use('/api', (_req, res) => res.status(404).set('Cache-Control', 'no-store').json({
  success: false,
  code: 'API_ROUTE_NOT_FOUND',
  message: 'This API endpoint is not available.'
}));

// Do not expose the repository root, source files, package metadata or AlpsCoinChain assets.
app.use((_req, res) => res.status(404).type('text/plain').send('Page not found.'));

app.listen(port, () => {
  console.log('VantagePay application server listening on port ' + port);
});
