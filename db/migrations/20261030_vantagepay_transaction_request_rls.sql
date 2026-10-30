-- VantagePay transaction-request customer insert permissions and international RLS allowlist.
-- Authenticated customers may create only their own pending requests.
-- Withdrawals require a verified beneficiary owned by the same authenticated customer.
-- This does not post ledger entries, move funds, or mark requests settled.
GRANT INSERT ON TABLE public.vp_transaction_requests TO authenticated;

DROP POLICY IF EXISTS vp_transaction_requests_insert_own_pending
  ON public.vp_transaction_requests;

CREATE POLICY vp_transaction_requests_insert_own_pending
ON public.vp_transaction_requests
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (SELECT auth.user_id()::uuid)
  AND status = 'pending'
  AND amount_minor_units > 0
  AND currency_code IN (
    'GBP','USD','EUR','CAD','AUD','CHF','SGD','JPY',
    'AED','NZD','ZAR','HKD','SEK','DKK','NOK'
  )
  AND (
    (request_type = 'deposit' AND beneficiary_id IS NULL)
    OR
    (
      request_type = 'withdrawal'
      AND beneficiary_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.vp_beneficiary_accounts AS b
        WHERE b.id = vp_transaction_requests.beneficiary_id
          AND b.user_id = (SELECT auth.user_id()::uuid)
          AND b.verification_status = 'verified'
      )
    )
  )
);
