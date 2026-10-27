/**
 * Public Supabase configuration for the browser runtime.
 *
 * These values are intentionally public:
 * - Project URL
 * - sb_publishable_* key
 *
 * Access is constrained by Postgres grants + RLS.
 * Never place a secret or service-role credential in this file.
 */
export const SUPABASE_PUBLIC_CONFIG = Object.freeze({
  projectUrl: "https://kopmcnabslumyweebjgf.supabase.co",
  publishableKey: "sb_publishable_VZJJ_027nXYDJr04BMFa_A_lpx1v5CM"
});
