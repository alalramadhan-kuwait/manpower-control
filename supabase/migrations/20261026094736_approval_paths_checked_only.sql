-- Approvals only through the server check (owner, 26 Oct 2026; audit finding 2).
-- approval_decide and request_header_decide accept a null check, and the legacy request_decide / change_request_decide
-- have no check: callable directly, they approve without the manpower check. The app decides only through
-- request_header_decide_checked (via the request-gate edge function), which is SECURITY DEFINER and owned by postgres,
-- so it keeps calling request_header_decide (and that the legacy functions) with the owner's rights.
-- No approval rule, permission of the checked path, or record changes. Tests: supabase/tests/approval_paths_checks.sql.
revoke execute on function public.approval_decide(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.request_header_decide(uuid, boolean, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.request_decide(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.change_request_decide(uuid, boolean, text) from public, anon, authenticated;
