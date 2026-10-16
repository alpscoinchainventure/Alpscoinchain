-- Atomically review fund requests and post the corresponding ledger entry.
-- Deposit approvals require an administrator-entered, independently verified transaction hash/ID.
-- Withdrawal approvals debit the available ledger balance; they do not execute the payout.

DROP FUNCTION IF EXISTS public.admin_review_fund_request(uuid, text, text);

CREATE FUNCTION public.admin_review_fund_request(
    p_request_id uuid,
    p_decision text,
    p_review_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_admin_id uuid := auth.uid();
    v_request public.fund_requests%ROWTYPE;
    v_decision text := lower(trim(coalesce(p_decision, '')));
    v_note text := nullif(trim(coalesce(p_review_note, '')), '');
    v_entry_result jsonb;
    v_entry_id uuid;
    v_ledger_reference text;
    v_description text;
BEGIN
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = v_admin_id
          AND lower(coalesce(p.role, '')) = 'admin'
          AND lower(coalesce(p.account_status, '')) = 'active'
    ) THEN
        RAISE EXCEPTION 'Active administrator access required' USING ERRCODE = '42501';
    END IF;

    IF v_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Decision must be approved or rejected';
    END IF;

    IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
        RAISE EXCEPTION 'Review note must be 1000 characters or fewer';
    END IF;

    IF v_decision = 'rejected' AND (v_note IS NULL OR length(v_note) < 3) THEN
        RAISE EXCEPTION 'A rejection reason of at least 3 characters is required';
    END IF;

    SELECT *
      INTO v_request
      FROM public.fund_requests
     WHERE id = p_request_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fund request not found';
    END IF;

    IF lower(coalesce(v_request.status, '')) NOT IN ('pending', 'under_review') THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'This request has already reached a final status',
            'status', v_request.status,
            'balance_changed', false
        );
    END IF;

    IF lower(coalesce(v_request.request_type, '')) NOT IN ('deposit', 'withdrawal') THEN
        RAISE EXCEPTION 'Unsupported fund request type';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = v_request.user_id
          AND lower(coalesce(p.role, '')) = 'client'
          AND lower(coalesce(p.account_status, '')) = 'active'
    ) THEN
        RAISE EXCEPTION 'Request does not belong to an active client account';
    END IF;

    IF v_decision = 'approved' THEN
        IF lower(v_request.request_type) = 'deposit' THEN
            IF v_note IS NULL OR length(v_note) < 8 THEN
                RAISE EXCEPTION 'Enter the independently verified deposit transaction hash or ID before approving';
            END IF;
            v_description := 'Deposit approved after administrator verification. Transaction hash/ID: ' || v_note;
        ELSE
            v_description := 'Withdrawal approved; available balance debited. This ledger entry does not confirm that the payout was sent.';
            IF v_note IS NOT NULL THEN
                v_description := v_description || ' Review note: ' || v_note;
            END IF;
        END IF;

        v_ledger_reference := 'FUNDREQ-' || replace(p_request_id::text, '-', '');

        v_entry_result := public.admin_post_ledger_entry(
            v_request.user_id,
            CASE
                WHEN lower(v_request.request_type) = 'deposit' THEN 'credit'
                ELSE 'debit'
            END,
            v_request.amount,
            v_request.asset,
            v_ledger_reference,
            v_description
        );

        IF coalesce((v_entry_result ->> 'success')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'Ledger entry was not confirmed; request approval cancelled';
        END IF;

        v_entry_id := (v_entry_result ->> 'entry_id')::uuid;
    END IF;

    UPDATE public.fund_requests
       SET status = v_decision,
           review_note = CASE
               WHEN v_decision = 'approved' AND lower(v_request.request_type) = 'deposit'
                   THEN 'Verified transaction hash/ID: ' || v_note
               ELSE v_note
           END,
           reviewed_by = v_admin_id,
           reviewed_at = now(),
           updated_at = now()
     WHERE id = p_request_id;

    RETURN jsonb_build_object(
        'success', true,
        'request_id', p_request_id,
        'request_type', v_request.request_type,
        'status', v_decision,
        'reference', v_request.reference,
        'ledger_entry_id', v_entry_id,
        'balance_changed', (v_decision = 'approved'),
        'payout_sent', false
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_review_fund_request(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_fund_request(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
