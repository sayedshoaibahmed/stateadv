# Security Advisor audit: 35 × `authenticated_security_definer_function_executable`

Date: 2026-11-11. Scope: the 35 functions the Supabase Security Advisor flagged ("Signed-in Users Can Execute SECURITY
DEFINER Function", 0 errors, 35 warnings). **Read-only audit**: no SQL, migration, grant or hosted change was made.

## 1. Result in one paragraph

All 35 warnings are the same, deliberate design: the app's signed-in role has **no write privilege on any table**
(`SELECT` on 22 tables only, no `INSERT`/`UPDATE`/`DELETE`, no column-level writes; `anon` has nothing), so every write
must go through a function, and those functions must be `SECURITY DEFINER` to write. Every one of the 35 has an empty
`search_path`, no dynamic SQL, `EXECUTE` revoked from `PUBLIC` and `anon`, an explicit check of `auth.uid()` and of an
active account before the first table access (or delegates to a function that does), and validated inputs.
**No function is VULNERABLE. 30 are SAFE. 5 NEED REVIEW (low severity, none a blocker): the protection they rely on
for one rule sits in the Next.js server action, not in the database.** No issue must be fixed before the First Owner is
created. All 35 warnings can safely remain.

## 2. Method and evidence

- Hosted definitions were read with read-only queries (`pg_get_functiondef`, `proacl`, `proconfig`, `has_function_privilege`).
  **Hosted equals the repository:** after migration 18, a local PostgreSQL 17 rebuilt from migrations 01-18 matched the
  hosted project function by function (85 of 85 definition hashes, plus security-definer flag, volatility, settings and
  privileges for `anon`, signed-in, `service_role` and `PUBLIC`). See `supabase/HOSTED_VERIFICATION.md` 0h.
- Read in full: the helpers (`is_active_user`, `require_active_user`, `require_reason`, `pl_uuid`, `proof_parent`,
  `insert_proofs`, `parse_files`, `decide_payment`, `guard_user_profiles`) and `active_owner_count`, `add_correction_files`,
  `add_payment`, `add_proofs`, `add_refund`, `approve_*`, `cancel_booking`, `hide_proof`, the six `profile_*`,
  `complete_password_change`, and the seven `upsert_*` / `set_resort_active` functions.
- For the rest (`change_cancellation_charge`, `create_booking`, `update_booking`, `set_booking_status`, `set_payment_schedule`,
  `plan_preview`, `update_waiting_*`, `reject_*`, `reverse_*`, `decide_refund`) I checked the same properties by structural
  scan (guard before first table access, columns written, raw payload reads, dynamic SQL, `set_config` keys) and relied on the
  tests listed in section 6. I did **not** line-by-line review every statement of those bodies.
- Not possible yet: running any of them as a real signed-in hosted user (no Owner or user exists). Runtime behaviour is
  proven on PGlite and on real PostgreSQL 17.11 (superuser and non-superuser), not on the hosted project.

### Facts that hold for all 35

| Check | Finding (evidence) |
|---|---|
| 6 `search_path` | `SET search_path TO ''` on all 35 (`proconfig = {search_path=""}`); every object is schema-qualified |
| Dynamic SQL | none (`EXECUTE` is not used in any of the 35) |
| 9 `EXECUTE` grants | ACL is exactly `postgres`, `service_role`, `authenticated`; `anon` 0, `PUBLIC` 0 (35/35). Owner of all: `postgres` |
| 10 `SECURITY DEFINER` required | Yes: `authenticated` has `SELECT` only on 22 tables and no non-SELECT table or column privilege; `anon` none. Switching these to `SECURITY INVOKER` would break every write; the rules (reasons, limits, locks, history) live inside them |
| 1, 2, 8 identity, active, NULL context | Guard is `public.require_active_user()` = `if auth.uid() is null or not public.is_active_user() then raise 'NOT_ALLOWED'`; `is_active_user()` checks `user_profiles.is_active` for `auth.uid()`. A missing session, an unknown user and a switched-off user are all refused. The caller is **never** taken from a parameter |
| `app.*` settings | only `app.reason` (audit text) is set by these functions; `app.owner_recovery` and `app.email_sync` are only honoured when `auth.uid()` is NULL, so a signed-in caller cannot use them |
| 5 inputs | all payload fields go through the `pl_*` parsers (uuid regex, bounded text, bigint range); enum casts are caught; storage paths must match `^(refunds/)?<uuid>/<uuid>.(jpg|png|webp|pdf)$`, start with the booking's own prefix, exist in Storage with the same size and type |
| 3, 4 roles and other people's data | Product rule Q10: Managers and Owners have the same operational access, and there is no per-resort or per-user data scoping, so no function filters by owner of the data. The only cross-user data is accounts, protected by `guard_user_profiles` (below) |
| 7 privilege escalation | Owner role can only be given by an Owner; Owner accounts can only be disabled, re-enabled, re-emailed, re-roled or flagged for password reset by **another** active Owner; nobody changes their own role or disables themselves; the last active Owner cannot be removed; `created_by` etc. are immutable. All enforced in the **trigger** `guard_user_profiles`, so they hold even if a function is bypassed |

## 3. The 35 functions

Classification key: **SAFE**, **NEEDS REVIEW** (protection unclear or incomplete), **VULNERABLE** (concrete weakness).

| # | Function | Class | Key evidence | Can the warning stay? |
|---|---|---|---|---|
| 1 | `active_owner_count()` | SAFE | `if not is_active_user() then raise`; returns only a count of active Owners (needed for the dashboard notice) | Yes |
| 2 | `is_active_user()` | SAFE | returns only whether the caller's own profile is active; used by RLS policies, so it must be executable by signed-in users | Yes |
| 3 | `add_correction_files(kind,parent,reason,files)` | SAFE | `require_active_user`; reason ≥ 10; booking row locked; only for **approved** payments/refunds; files validated by `parse_files` | Yes |
| 4 | `add_payment(payload,files,idem)` | SAFE | `require_active_user`; idempotency key required; booking locked first; amount 1..10^15; method enum; provider check; proof required for UPI/card/cheque; cancelled-booking rule | Yes |
| 5 | `add_proofs(kind,parent,files)` | SAFE | `require_active_user`; only while status is `waiting`; max 5 files; path prefix tied to the booking | Yes |
| 6 | `add_refund(payload,files,idem)` | SAFE | `require_active_user`; reason ≥ 5; Q12 overpayment rule; limit warnings; proof rule | Yes |
| 7 | `approve_payment(id,version)` | SAFE | wrapper of `decide_payment`, whose first statement is `require_active_user`; version check; "already decided by X" for the second person | Yes |
| 8 | `approve_refund(id,version)` | SAFE | same via `decide_refund` | Yes |
| 9 | `cancel_booking(...)` | SAFE | `require_active_user`; kind restricted to cancelled/no-show; version check; charge range; date not in the future; reasons required. Note: the reason length is validated in the DECLARE block, before the guard (see finding F5) | Yes |
| 10 | `change_cancellation_charge(...)` | SAFE | `require_active_user`; reason required; version check (structural scan + CAN tests) | Yes |
| 11 | `create_booking(payload,plan,idem)` | SAFE | `require_active_user`; all fields through `pl_*`; amounts recalculated by the database; browser-sent amounts, status, version and `created_by` are ignored (test BKF-02) | Yes |
| 12 | `hide_proof(id,reason)` | SAFE | `require_active_user`; correction files cannot be hidden; originals of approved items are locked by trigger (COR-04) | Yes |
| 13 | `plan_preview(...)` | SAFE | `require_active_user`; writes nothing | Yes |
| 14 | `reject_payment(id,version,reason)` | SAFE | via `decide_payment`; reason ≥ 5 | Yes |
| 15 | `reject_refund(...)` | SAFE | via `decide_refund` | Yes |
| 16 | `reverse_payment(...)` | SAFE | via `decide_payment`; reason ≥ 5; blocked while refunds depend on it (D5) | Yes |
| 17 | `reverse_refund(...)` | SAFE | via `decide_refund` | Yes |
| 18 | `set_booking_status(...)` | SAFE | `require_active_user`; transition rules and undo-reason rule enforced (DEC-2); only `status` is written | Yes |
| 19 | `set_payment_schedule(...)` | SAFE | `require_active_user`; plan must add up; past-due rows locked by trigger | Yes |
| 20 | `set_resort_active(id,active)` | SAFE | `require_active_user`; NULL refused; not-found refused | Yes |
| 21 | `update_booking(...)` | SAFE | `require_active_user`; version check; reason rules; writes a fixed column list through `pl_*` parsers | Yes |
| 22 | `update_waiting_payment(...)` | SAFE | `require_active_user`; only while waiting; reason required; fixed column list | Yes |
| 23 | `update_waiting_refund(...)` | SAFE | same, plus the amount-due limit (decision 5) | Yes |
| 24 | `upsert_co_category(...)` | SAFE | `require_active_user`; name 1..60; mode in (listed, typed, none); duplicate names refused | Yes |
| 25 | `upsert_co_entry(...)` | SAFE | `require_active_user`; only in a `listed` category; an entry cannot be moved to another category | Yes |
| 26 | `upsert_guest(...)` | SAFE | `require_active_user`; name length, mobile 5..20 digits, email pattern | Yes |
| 27 | `upsert_provider(...)` | SAFE | `require_active_user`; method restricted to UPI/card; case-insensitive duplicate check; method cannot change | Yes |
| 28 | `upsert_resort(...)` | SAFE | `require_active_user`; code `^[A-Z0-9]{2,10}$`; logo path must be `<this resort's id>/<uuid>.(jpg|png|webp)` **and** exist in the `resort-logos` bucket | Yes |
| 29 | `upsert_stay_type(...)` | SAFE | `require_active_user`; name 1..60 | Yes |
| 30 | `profile_create(id,name,email,role,phone,reason)` | SAFE | active caller; the profile must belong to an **existing Auth login with the same email**; an Owner can only be created by an Owner (trigger) with a reason ≥ 10; duplicates refused | Yes |
| 31 | `profile_update(id,name,phone,role,reason)` | NEEDS REVIEW (F1) | active caller; own role change refused; role change needs reason ≥ 10; Owner rules in the trigger. Weakness: the "re-enter your own password" step (O3) is not in the database | Yes |
| 32 | `profile_set_active(id,active,reason)` | NEEDS REVIEW (F1) | active caller; Owner target needs reason ≥ 10; self-disable and last-Owner refused by the trigger. Same F1 | Yes |
| 33 | `profile_reset_password(target,reason)` | NEEDS REVIEW (F1) | active caller; not self; target must be active; Owner target needs another Owner and reason ≥ 10; it only **flags** `must_change_password` (the password itself is set by the server action) | Yes |
| 34 | `profile_change_email(id,new_email,reason)` | NEEDS REVIEW (F1, F2) | active caller; not self; Owner target needs an Owner actor; reason ≥ 10. F2: writes the profile email without checking the Auth email | Yes |
| 35 | `complete_password_change()` | NEEDS REVIEW (F3) | active caller; only touches the caller's own row (`id = auth.uid()`). F3: it cannot prove a password change really happened | Yes |

**VULNERABLE: none.**

## 4. Findings and recommended fixes

None of these is a blocker; all are about defence in depth. The order is by value.

**F1: the acting Owner's password re-entry (O3) is enforced only by the server action `gate()`, not by the database.**
**Status 2026-11-12: fixed by migration 19 (`20261111000019_reauth_grants.sql`: single-use re-authentication grants bound to the exact operation, attempts reserved before the password; see `SECURITY.md` section 15), committed in `91a4d13` and APPLIED to the hosted project and verified (`HOSTED_VERIFICATION.md` 0i). The four `profile_*` functions and `profile_create` (for an Owner) now refuse a protected action without a grant. The text below describes the weakness as it was before.**
Affected: `profile_update` (role change), `profile_set_active`, `profile_reset_password`, `profile_change_email`.
Evidence: `src/lib/accounts/actions.ts` `gate()` calls `verifyPassword(...)`; none of the four SQL functions checks it
(the database cannot see a password). The database does enforce: another active Owner is required for any action on an
Owner account, a reason of at least 10 characters, no self-disable, no self-role-change, and the last Owner can never be
removed (trigger `guard_user_profiles`, tests OWN-*, USR-*). What is missing: someone holding a valid Owner session token
(for example on an unattended, logged-in device) can call the REST function directly and skip the password prompt. The
stated purpose of O3 is exactly "an unattended logged-in device" (PRD O3), and an attacker using the app screens is still
stopped by the prompt; only a technical attacker with the token is not.
Fix options (none needed now): (a) accept and keep documenting it (SECURITY.md 216 already says the call is app-layer);
(b) later, make the database require a recent password sign-in by checking the JWT claim `amr` (method `password` with a
timestamp within about 5 minutes) inside these four functions; the app would then ask the Owner to sign in again. Cost:
a new migration and a UX change; do it with the first production hardening, not before the Owner exists.

**F2: `profile_change_email` can change the profile email without the Auth email changing.**
Evidence: the function updates `user_profiles.email` only; the server action then calls the Auth admin API and undoes the
profile change if that fails. A Manager calling the function directly (only for non-Owner targets; Owners are protected)
can leave another Manager's profile email different from the login email. Impact: low. Login uses the Auth email; the
profile email is shown to people and checked when a profile is created. It cannot reach Owner accounts.
Fix option: have the action update Auth first and let the function require `lower(auth.users.email) = new email`
(with the verified-sync trigger as today). Needs an order change in `changeUserEmail` plus a migration; not required now.

**F3: `complete_password_change` clears the "must change password" flag without proof.**
Already documented as an accepted limit in migration 11: "the flag is a reminder, not a security boundary against the
account holder themselves". Impact: only the account holder can skip their own forced change, and only matters for temporary
passwords someone else knows. It never affects other accounts.
Fix option: require `auth.users.updated_at` to be newer than the moment the flag was set. For the First Owner this is not
relevant (the password is typed by the Owner privately).

**F4 (observation, not a finding): any active user may approve any payment, including their own.** This is the approved
decision Q8 (self-approval allowed and flagged). Not a defect.

**F5 (observation): validation before the guard.** In `cancel_booking`, `change_cancellation_charge`, `hide_proof`,
`add_payment`, `add_refund`, `create_booking` some validation (`require_reason`, parsers) runs in the DECLARE block,
before `require_active_user()`. An inactive signed-in user with a bad input would see an input error instead of
`NOT_ALLOWED`; no data is read or written, and anon cannot call them. No change needed.

**F6 (observation): name and phone of an Owner account can be edited by a Manager.** The approved list of protected Owner
actions (O1) covers disabling, enabling, email, role and password-reset flag only. This is by design.

## 5. Can the warnings stay?

Yes, all 35. The lint is generic ("a signed-in user can call a SECURITY DEFINER function"); here it is the intended API.
Revoking `EXECUTE` would break the product; switching to `SECURITY INVOKER` would require giving the app role write
privileges on the tables, which is a weaker design. If you want the Advisor list quiet, the Supabase-recommended
alternative is to move the functions to a non-exposed schema and call them from server code with the secret key, which is a
large redesign and not recommended.

## 6. Tests run (existing, unchanged)

`tests/db/schema-security`, `account-management`, `account-self-service`, `users-owner-protection`, `owner-decisions`,
`guard-branches`, `storage-policies`, `approval-access`, `first-owner`, `master-data-functions`,
`payment-refund-functions`, `booking-functions`, `email-change-and-corrections` and `tests/unit/accounts`:
**14 files, 234 tests, all passed (PGlite)**. SEC-04 asserts the allow-list of exactly the callable functions and none
for anon. The same suites passed on real PostgreSQL 17.11 earlier today, as superuser and as the plain `postgres` role.

## 7. Does anything need fixing before the First Owner is created?

**No.** F1-F3 are hardening items for later (before real Managers are added with admin-set temporary passwords, and
before production). Nothing here affects creating the first Owner, whose password is typed privately and whose account the
database protects against being removed or demoted.
