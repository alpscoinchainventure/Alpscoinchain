-- VantagePay international sandbox currency constraints.
-- NGN and Nigerian account-opening country codes are excluded.
ALTER TABLE public.vp_demo_account_applications DROP CONSTRAINT IF EXISTS vp_demo_account_applications_currency_code_check;
ALTER TABLE public.vp_demo_account_applications DROP CONSTRAINT IF EXISTS vp_demo_account_applications_country_code_check;
ALTER TABLE public.vp_demo_account_applications ADD CONSTRAINT vp_demo_account_applications_currency_code_check CHECK (currency_code IN ('GBP','USD','EUR','CAD','AUD','CHF','SGD','JPY','AED','NZD','ZAR','HKD','SEK','DKK','NOK'));
ALTER TABLE public.vp_demo_account_applications ADD CONSTRAINT vp_demo_account_applications_country_code_check CHECK (country_code ~ '^[A-Z]{2}$' AND country_code <> 'NG');
ALTER TABLE public.vp_demo_bank_accounts DROP CONSTRAINT IF EXISTS vp_demo_bank_accounts_currency_code_check;
ALTER TABLE public.vp_demo_bank_accounts ADD CONSTRAINT vp_demo_bank_accounts_currency_code_check CHECK (currency_code IN ('GBP','USD','EUR','CAD','AUD','CHF','SGD','JPY','AED','NZD','ZAR','HKD','SEK','DKK','NOK'));
ALTER TABLE public.vp_transaction_requests DROP CONSTRAINT IF EXISTS vp_transaction_requests_currency_code_check;
ALTER TABLE public.vp_transaction_requests ADD CONSTRAINT vp_transaction_requests_currency_code_check CHECK (currency_code IN ('GBP','USD','EUR','CAD','AUD','CHF','SGD','JPY','AED','NZD','ZAR','HKD','SEK','DKK','NOK'));
ALTER TABLE public.vp_apy_source_events DROP CONSTRAINT IF EXISTS vp_apy_source_events_currency_code_check;
ALTER TABLE public.vp_apy_source_events ADD CONSTRAINT vp_apy_source_events_currency_code_check CHECK (currency_code IN ('GBP','USD','EUR','CAD','AUD','CHF','SGD','JPY','AED','NZD','ZAR','HKD','SEK','DKK','NOK'));
ALTER TABLE public.vp_external_reward_events DROP CONSTRAINT IF EXISTS vp_external_reward_events_currency_code_check;
ALTER TABLE public.vp_external_reward_events ADD CONSTRAINT vp_external_reward_events_currency_code_check CHECK (currency_code IN ('GBP','USD','EUR','CAD','AUD','CHF','SGD','JPY','AED','NZD','ZAR','HKD','SEK','DKK','NOK'));
