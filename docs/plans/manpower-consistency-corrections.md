# Manpower calculation consistency — correction plan

Status: **proposed, not applied** (audit 26 Oct 2026). Nothing below changes an approval rule. Each item needs the
owner's separate approval before it is deployed.

| # | Priority | Finding | Correction | Changes | Risk | Rollback |
|---|---|---|---|---|---|---|
| 1 | **High** | The server check (`request-gate` edge function, v5, deployed 18 Oct) is older than the app engine. On the first day of a planned PV not approved, the server counts the person away; every screen counts them present (rule of 24 Oct). Approvals can show "allowed" and the server refuse, or the reverse, on that day. | Rebuild the function from the current `src/core` and `src/data` (`npm run functions:build`) and deploy it. Add a build check that fails when the committed bundle is older than the engine files, and print the engine version in the check result so a mismatch is visible. | `supabase/functions/request-gate/index.ts` (generated), `scripts/build-shift-alerts.mjs` (check), deploy | Low: same engine as the screens. First-day decisions change to match the screens | Redeploy v5 bundle (kept in git history) |
| 2 | **High** | Four database functions approve without the server check: `approval_decide` and `request_header_decide` (a null check passes `request_check_allows`), and the legacy `request_decide`, `change_request_decide`. Section Head only, not used by the app, but callable directly. | One migration: `revoke execute … from authenticated` on `approval_decide`, `request_header_decide`, `request_decide`, `change_request_decide` (the app uses `request_header_decide_checked` through `request-gate`); `request_header_decide` keeps working for the checked wrapper (security definer, same owner). Integrity test: an approval without a server check is refused. | `supabase/migrations/<version>_approval_paths_checked_only.sql`, README row, `supabase/tests/…` | Medium: confirm no screen calls them (code search: none) before applying | Re-grant in a follow-up migration |
| 3 | Medium | A crew left without a Controller (cover needed) is not a finding of the request check: Approvals can say "No rule broken". | Add a **warning** finding "Controller cover needed on N duties (crew X)" from the same engine result (`coverage_required` added by the change). Severity warning: never blocks, the Section Head may still approve. | `src/data/validation.ts` (+ test), redeploy `request-gate` (with item 1) | Low: information only | Remove the finding |
| 4 | Low | Task releases are left out of two impact views (paper-form request page, PV reschedule / shutdown leave move); the Calendar, Approvals and the server include them. No active task release today. | Use `absencesAll` (leave + task releases) in `RequestPage` (`requestImpact`) and `leaveTools.leaveImpact`. | 2 files + tests | Low | Revert the two lines |

Order: 1 and 2 together (one approval: deploy + migration), then 3 (rides on the redeploy of 1), then 4.

Tests before deploy: unit tests for the warning and the inputs; the integrity SQL test ends ALL PASS; a rolled-back
transaction shows the revoked functions refuse a direct call and the checked path still approves; the first-day case
gives the same verdict in Approvals and on the server.
