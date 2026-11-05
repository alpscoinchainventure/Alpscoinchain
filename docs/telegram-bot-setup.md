# AlpsCoinChain Telegram assistant

Bot: [@Alpscoinchaininvest_Bot](https://t.me/Alpscoinchaininvest_Bot)

This integration is isolated to the AlpsCoinChain Investment Ventures app and its existing Supabase project. It does not connect to VantagePay or the X/Buffer bot.

## Required server environment variables

Set these only in the AlpsCoinChain Vercel project's Production and Preview environments as appropriate:

- `TELEGRAM_BOT_TOKEN`: newly rotated token from BotFather. Do not reuse the token previously pasted into chat.
- `TELEGRAM_WEBHOOK_SECRET`: random 32+ character secret used to authenticate Telegram webhook requests.
- `TELEGRAM_ADMIN_CHAT_ID`: private Telegram chat ID for support escalations (optional but required for /support forwarding).
- `SUPABASE_SERVICE_ROLE_KEY`: service-role secret for the AlpsCoinChain Supabase project `uevofmlzpwrdidjnwxfd`. Server-side only; never put in browser code or commit it.
- `SUPABASE_URL`: optional; defaults to the AlpsCoinChain project URL.
- `SUPABASE_PUBLISHABLE_KEY`: optional; defaults to the existing public publishable key.

Never put any of these values in GitHub source, public HTML, or a message to ChatGPT.

## Database migration

Apply `supabase/migrations/20261105090000_telegram_account_linking.sql` to the AlpsCoinChain Supabase project. The two tables have RLS enabled and no anon/authenticated grants; only the server-side service role can access them.

## Deploy and set the Telegram webhook

After the migration and environment variables are set and the Vercel deployment is live, set the webhook from a trusted terminal. Replace placeholders locally; do not paste the token into chat:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://alpscoinchaininvestment.uk/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  -d 'allowed_updates=["message"]'
```

Check webhook status without sharing the token:
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

## Customer account linking

A signed-in customer opens `/telegram-link.html`, generates a one-time 8-character code (10-minute expiry), then sends `/link CODE` to the bot. The code is hashed in the database and cannot be reused. Private account commands are unavailable until linking succeeds.

## Commands implemented

- `/start`, `/help`
- `/link CODE`
- `/account`, `/balance`, `/history`
- `/plans`, `/apy`, `/profits`
- `/deposit AMOUNT ASSET` (creates a pending fund request; never credits a balance)
- `/transaction REFERENCE`
- `/notifications`
- `/support MESSAGE` (forwards to the configured admin chat)
- `/withdraw` (directs the customer to the authenticated dashboard and saved-beneficiary workflow)

APY reports remain informational. They never alter ledger balances. Only actual posted ledger entries are reflected in /balance. Withdrawals are not executed by Telegram.

## Operational notes

Vercel serverless functions use Telegram webhooks; do not run long-polling in a serverless deployment. Telegram delivery is best-effort and must never change or roll back an account or ledger transaction.
