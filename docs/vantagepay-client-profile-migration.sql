-- VantagePay client-profile migration.
-- Apply only to the dedicated VantagePay Neon project/branch after review.
-- This is independent of AlpsCoinChain data. It stores profile metadata only;
-- profile-picture upload/storage is not enabled by this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vp_customer_profiles (
  user_id UUID PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL DEFAULT '',
  phone_number TEXT,
  city TEXT,
  country_code CHAR(2),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(display_name) <= 100),
  CHECK (phone_number IS NULL OR length(phone_number) <= 24),
  CHECK (city IS NULL OR length(city) <= 100),
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CHECK (avatar_url IS NULL OR (length(avatar_url) <= 2048 AND avatar_url ~ '^https://'))
);

ALTER TABLE public.vp_customer_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vp_customer_profile_select_own ON public.vp_customer_profiles;
DROP POLICY IF EXISTS vp_customer_profile_select_own ON public.vp_customer_profiles;
CREATE POLICY vp_customer_profile_select_own ON public.vp_customer_profiles
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS vp_customer_profile_insert_own ON public.vp_customer_profiles;
DROP POLICY IF EXISTS vp_customer_profile_insert_own ON public.vp_customer_profiles;
CREATE POLICY vp_customer_profile_insert_own ON public.vp_customer_profiles
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS vp_customer_profile_update_own ON public.vp_customer_profiles;
DROP POLICY IF EXISTS vp_customer_profile_update_own ON public.vp_customer_profiles;
CREATE POLICY vp_customer_profile_update_own ON public.vp_customer_profiles
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.vp_customer_profiles FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.vp_customer_profiles TO authenticated;

COMMIT;
