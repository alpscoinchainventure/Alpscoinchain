# VantagePay authentication, KYC, and email setup

This runbook applies only to the dedicated VantagePay Neon project and Vercel project. Do not apply it to shared AlpsCoinChain Supabase projects.

## Email verification

In Neon Console, open the VantagePay project's Auth configuration for branch `br-gentle-term-bagpxjdi` and confirm:

- Email/password sign-up is enabled.
- Email verification method is OTP.
- Send verification email on sign-up is enabled.
- Require email verification is enabled.
- Auto sign-in after verification is enabled if that matches the chosen customer journey.
- The shared Neon sender is acceptable for development testing. Configure a custom SMTP sender before production.

The VantagePay page explicitly requests a verification code and requires the authenticated user to have `emailVerified === true` before protected API access. Test registration, code delivery, code verification, resend, login, and protected access using a real inbox. Do not mark the flow operational based only on an accepted sign-up response.

The current connected Neon configuration API does not expose the verification flags as safe writable fields. Do not edit `neon_auth.project_config` directly to bypass the managed configuration interface.

## Transactional email

The API uses a Resend-compatible sender. Add these Vercel project environment variables only after creating a Resend account and verifying the sender domain/address:

- `VANTAGEPAY_RESEND_API_KEY` — secret value; never expose to browser code.
- `VANTAGEPAY_EMAIL_FROM` — verified sender identity, for example `VantagePay <notifications@your-verified-domain.example>`.

Add the variables to Preview first, verify delivery and provider responses, then configure Production only during an explicitly approved production release. The application reports `not_configured` or `failed` rather than claiming an email was sent. In-app notifications are distinct from email delivery.

Notification email events currently include deposit/withdrawal request receipt, request-status changes, KYC profile submission, and KYC review decisions. Live financial transactions are not active; no settlement email should be sent until a real approved provider settlement is confirmed.

## KYC workflow

Customers can create/update a profile with legal name, date of birth, country, residential address, city, postal code, and document type. The record is linked to the authenticated Neon Auth user. The customer can see review status and resubmit after a decision.

The current workflow is a profile review workflow, not independent identity verification. It deliberately does not accept identity-document uploads or full document numbers. Before collecting documents or representing a customer as identity-verified, select and configure an approved KYC provider with secure upload, verification results/webhooks, retention/deletion policy, and operational review.

The admin queue requires an explicitly provisioned, enabled VantagePay admin membership. Do not grant admin privileges to a customer automatically or let customers set their own review status.

## Deployment and safety

- Keep changes on `vantagepay-premium-dashboard` / PR #17 until checks pass and release is approved.
- Never merge PR #17 or deploy Production without explicit authorization.
- Vercel's preview deployment API currently reports its free daily deployment limit has been reached. Do not change plans or use another team to bypass that limit.
- Live deposits, withdrawals, transfers, settlement, and balance adjustments remain disabled.
