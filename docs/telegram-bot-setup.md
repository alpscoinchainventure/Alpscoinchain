# AlpsCoinChain Telegram assistant

Bot: [@Alpscoinchaininvest_Bot](https://t.me/Alpscoinchaininvest_Bot)

This integration is isolated to the AlpsCoinChain Investment Ventures app and its existing Supabase project. It does not connect to VantagePay or the X/Buffer bot.

## Required server environment variables

Set these only in the AlpsCoinChain Vercel project's Production and Preview environments as appropriate:

- `TELEGRAM_BOT_TOKEN`: newly rotated token from BotFather. Do not reuse the token previously pasted into chat.
- `TELEGRAM_WEBHOOK_SECRET`: random 32+ character secret used to authenticate Telegram webhook requests.
- `TELEGRAM_ADMIN_CHAT_ID`: private Telegram chat ID for support escalations (optional but required for /support forwarding).
- `SUPABASE_SECRET_KEY`: preferred `sb_secret_...` server-side secret key for the AlpsCoinChain Supabase project `uevofmlzpwrdidjnwxfd`. Server-side only; never put in browser code or commit it. The legacy `SUPABASE_SERVICE_ROLE_KEY` is accepted as a temporary fallback.
- `SUPABASE_URL`: optional; defaults to the AlpsCoinChain project URL.
- `SUPABASE_PUBLISHABLE_KEY`: optional; defaults to the existing public publishable key.

Never put any of these values in GitHub source, public HTML, or a message to ChatGPT.

## Database migration

Apply `supabase/migrations/20261105090000_telegram_account_linking.sql` to the AlpsCoinChain Supabase project. The two tables have RLS enabled and no anon/authenticated grants; only the server-side Supabase secret/service key can access them.

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

- `/start`, `/help`, `/learn`, `/beginner`
- `/forex`, `/crypto`, `/risks`
- `/steps`, `/gettingstarted`, `/website`, `/signup`
- `/groupintro` (responds only when a group owner/admin explicitly invokes it)
- `/outreach` (admin-only approved community-post draft; manual sharing only)
- `/link CODE`
- `/account`, `/balance`, `/history`
- `/plans`, `/apy`, `/profits`
- `/deposit AMOUNT ASSET` (creates a pending fund request; never credits a balance)
- `/transaction REFERENCE`
- `/notifications`
- `/support MESSAGE` (forwards to the configured admin chat)
- `/withdraw` (directs the customer to the authenticated dashboard and saved-beneficiary workflow)

APY reports remain informational. They never alter ledger balances. Only actual posted ledger entries are reflected in /balance. Withdrawals are not executed by Telegram.

## Community discovery and outreach

The bot does not automatically join groups, scrape member lists, send unsolicited private messages, or post promotional messages without an administrator request. A group owner/admin can add the bot and explicitly invoke `/groupintro`. The private admin chat can use `/outreach` to generate a compliant draft for manual sharing only where promotion is allowed. Other social networks require their own approved platform integrations and human review.

## BotFather command list

Register these commands with `/setcommands`:

```text
start - Welcome and customer menu
help - Show all commands
learn - Beginner learning path
forex - Learn forex basics
crypto - Learn crypto-asset basics
risks - Understand investment risks
steps - Step-by-step getting started guide
website - Official website and signup
plans - View published investment plans
apy - View published APY information
profits - View published return reports
link - Link your customer account
account - View linked account status
balance - View posted ledger balances
history - View recent posted ledger activity
deposit - Submit a deposit request for review
transaction - Check a request reference
notifications - Manage account notifications
support - Contact customer support
groupintro - Admin-approved introduction in an invited group
outreach - Generate an admin-only community post draft
```

Enable group joining in BotFather only if you intend to invite the bot to a group. Keep privacy mode enabled; group administrators can invoke `/groupintro` explicitly without the bot reading every group message.

## Operational notes

Vercel serverless functions use Telegram webhooks; do not run long-polling in a serverless deployment. Telegram delivery is best-effort and must never change or roll back an account or ledger transaction.
