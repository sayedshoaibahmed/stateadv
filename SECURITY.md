# SECURITY — Authentication, Permissions, Storage and Data Safety

| Item | Value |
|---|---|
| Milestone | M0 (design). Implemented in M2, verified in M9. |
| Status | M0 final draft |
| Last updated | 2026-11-11 |

## 1. Threat model
| Threat | Example |
|---|---|
| Outsider access | Guessing URLs, or calling the API with the public anon key |
| Former staff | A disabled manager's old session or password |
| Insider manipulation | Editing an approved amount, deleting a payment, faking who approved, inflating a refund |
| Account misuse | One user disabling others, or creating fake accounts |
| Fake proofs | Re-using an old screenshot |
| Leaked files | A screenshot link forwarded on WhatsApp |
| Accidental loss | A migration or script dropping data; storage deleted |
| Credential leaks | The Supabase secret key in git or in the browser |

## 2. Authentication (Q10)
- Supabase Auth, **email + password**. **Public sign-up disabled.**
- Accounts are created by existing users (§3.2) with email already confirmed and a temporary password. `must_change_password = true` forces a change at the next login (proxy redirect).
- Password policy: at least 8 characters, leaked-password protection on (if the hosting plan supports it, Q11).
- Sessions: `@supabase/ssr` HTTP-only cookies, refreshed in the proxy (`src/proxy.ts`, which validates the JWT with `getClaims()`). JWT expiry 1 h, refresh-token rotation on. Every server action calls `supabase.auth.getUser()` (which verifies the token with Auth), not just `getSession()`.
- The app displays the user's **full name**. Email is shown only on the Users page and login.
- **Email change (O7):** Supabase Auth setting "Secure email change" is ON (the old and the new address must both confirm). Email change always requires a fresh password check in our Server Action first. Confirmation links are single-use and expire. Until confirmed, nothing changes.
- Brute force is limited by Supabase Auth rate limits, and the login error message does not say whether the email exists.
- Password reset for Managers is done by another user setting a temporary password. No email is needed.
- Owner accounts: a reset by another Owner (password re-entry + reason), **or** the "Forgot password" email link, which is enabled for Owner accounts only. Production needs a reliable email sender (custom SMTP; cost under Q11).
- **MFA (TOTP) is strongly recommended for Owner accounts** (O4).

### 2.1 How the app checks a request (implemented)
- `src/proxy.ts` is only a quick first check: no valid login token → redirect to `/login`. It never decides what a user may do.
- Every protected page, layout and action calls `requireUser()` (`src/lib/auth/session.ts`), which (1) asks Supabase Auth to confirm the session (`getUser()`), (2) reads the user's profile **with the user's own login**, so row-level security returns nothing for a switched-off account, and (3) sends a user with a temporary password to the change-password page. Nothing is cached: a switched-off account loses access on its next request.
- A person with a correct password but no active profile is signed out at `/auth/blocked` (a GET route that only ends the caller's own session).
- "Forgot password" works for **active Owner accounts only** and always shows the same answer. To decide this it uses the secret key in one narrow, server-only lookup of `role, is_active`; the result never reaches the browser.
- The `next` address after sign-in is accepted only if it stays inside the app (`safeNext`).
- Known limit: `complete_password_change()` cannot prove a password really changed (the database never sees passwords). The flag is a reminder for the account holder, not a barrier against themselves.

## 3. Authorisation

### 3.1 Same access for every active user
Every active user has the **same operational permissions, including user management of Manager accounts** (Q10). For operations, permission checks reduce to "is this an active, logged-in user?", enforced **in the database**.
The Owner/Manager role matters in exactly one place: **Owner-account protection** (§3.2).

### 3.2 User management controls
| Rule | Enforcement |
|---|---|
| Only active users can manage accounts | Server Action session check + `is_active_user()` in the profile RPCs |
| **A user cannot disable themselves** | Server Action check + `profile_set_active` refuses `auth.uid()` + trigger `disabled_by <> id` |
| Every account action audited | Profile RPCs write `audit_logs` (actor, target_user_id, action, old/new). Passwords are never logged. |
| Disable takes effect immediately | `is_active=false` (RLS blocks all reads/RPCs at once) + Auth ban (refresh tokens rejected) |
| Disabled user's history preserved | Profiles are never deleted, and names stay on records |
| Re-enable possible | Any active user can enable a disabled Manager account. Owner accounts are re-enabled by an Owner or by recovery. (Audited.) |
| **At least one active Owner always** | Profile RPC under a table lock + `user_profiles_guard` trigger → `LAST_OWNER_PROTECTED` |
| **Protected Owner actions** (O1): disable, password reset, email change, role change of an Owner account | Only an active Owner actor ≠ target (RPC + trigger). Server Action re-verifies the actor's password. Reason required. Dashboard alert to all users. |
| **Owner role grants** (O2) | Only an active Owner can create an Owner or promote someone to Owner |
| **Recovery** (O4) | 1) another Owner resets (only when a second Owner exists); 2) "Forgot password" email for Owner accounts; 3) last resort: `scripts/recover-owner.ts` run locally with the Supabase secret key → `recover_owner_account` (service role only) + Auth admin unban/reset/MFA-factor removal, audited `owner_recovered` |
| **Single-Owner start** (O5) | The first Owner is created by `scripts/create-first-user.ts`. It refuses to run if any profile already exists, so it can never add a second Owner. No dummy or fake-email Owner is ever created. |
| **Adding the second Owner** (O6) | Only an active Owner, in Settings → Users → Add User (role Owner), with a reason and password re-entry (same controls as O3). Audited, with a dashboard alert. |

Recommended setup: **two Owner accounts**, both with MFA. The Supabase and Vercel dashboard logins (which hold the Supabase secret key needed for recovery) must belong to the business owner, with MFA, and must never be shared.

### 3.2a Operating with exactly one Owner (O5): limitations
The system is secure with one active Owner: every rule in §3.2 still holds. The sole Owner cannot be disabled, demoted, password-reset or re-emailed by anyone else, and cannot disable themselves, so the account cannot be removed by mistake or by a Manager. The price is a narrower recovery path:

| Situation with one Owner | What happens | What helps |
|---|---|---|
| Owner forgets the password | No other Owner can reset it. Managers **cannot** (O1). Self-service only: the "Forgot password" email link. | A mailbox only the Owner controls, with its own MFA. Working email sending (development: Supabase built-in sender, which is rate-limited and may only deliver to addresses of your Supabase team members; production: custom sender, Q11). |
| Owner also loses access to that mailbox | App recovery is impossible. Only the recovery script remains. | Keep mailbox recovery options current. |
| Owner loses the MFA device | Same as above. The script removes the lost MFA factor. | Store MFA recovery codes offline (paper or a password manager). |
| Owner wants a new login email | The Owner may do this themselves (O7): current password, then confirmation of the new address (and the old address when Secure email change is on). Nothing changes until confirmed; the profile takes only the confirmed address. An admin change of an Owner's email still needs another Owner. | Keep both mailboxes under the Owner's control until the change is confirmed. If the old mailbox is already lost, only the recovery script can help. |
| Recovery script needed | Requires the Supabase dashboard login (to get the secret key) and a trusted computer. Anyone holding the secret key could reset the Owner, so these logins are the real root of trust. | Supabase and Vercel logins in the business owner's name with MFA, ideally with a second trusted person as an administrator of the Supabase organisation. |
| Dashboard login is also lost | The app cannot help. Recovery goes through Supabase account recovery. | Same as above. |
| The Owner leaves the business or hands over | The sole Owner cannot be removed by anyone. | First add the new Owner (O6). The new Owner can then disable the old one under O1/O3 (reason, password, alert). |
| Sensitive Owner-account actions | There is no second person to review them. The sole Owner can still add Owners and change other accounts, and every action is audited. | A second Owner, and the dashboard notice (FR-AUTH-14). |
| Disabled sole Owner | Impossible through the app (`LAST_OWNER_PROTECTED`). Only the secret key, directly in the database, could do it, and that is treated as an incident. | Keep the secret key private; rotate it after any suspicion. |

Operating rules while there is one Owner:
1. Enable MFA on the Owner account before real data is entered.
2. Keep the recovery steps in DEPLOYMENT_GUIDE §7.4 and test the recovery script on staging before go-live.
3. A visible notice is shown to the Owner on the dashboard and the Users page until a second Owner exists.
4. The owner decides before go-live (M10) whether to add a second Owner or to sign off on these limitations, and the decision is recorded in PROGRESS.md.

**Remaining business risk (R16):** a Manager can still disable or reset other Managers (decided Q10). Mitigations: the audit trail, alerts, self-disable block, and any user can re-enable a Manager.

### 3.3 Row Level Security
- RLS **enabled on every table** in `public`. A DB test fails if any table lacks it.
- `anon`: no grants at all.
- `authenticated`: `SELECT` only, `USING (public.is_active_user())`. **No direct INSERT/UPDATE/DELETE.** All writes go through `SECURITY DEFINER` RPCs that:
  - first check `is_active_user()`;
  - use `set search_path = public, pg_temp`;
  - validate all inputs, transitions and limits;
  - lock rows (`FOR UPDATE`) for financial changes;
  - write audit entries.
- Internal functions (`next_booking_code`, etc.) are not executable by `authenticated`.
- Views use `security_invoker = true`.

### 3.4 Why RPC-only writes
Atomic multi-table financial operations (booking + ID + plan; approval + history; refund + limit check). It also stops someone calling the REST API with a valid session to, say, set `status='approved'` directly while skipping history, proof rules and limits.

## 4. Secrets and keys
| Secret | Where | Never |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (sb_publishable_…) | browser + server | — (safe, protected by RLS) |
| `SUPABASE_SECRET_KEY` (sb_secret_…, the replacement for the legacy service-role key) | Vercel server env only; used only in `src/lib/supabase/admin.ts` (`import 'server-only'`) | `NEXT_PUBLIC_*`, client code, git, logs |
| `CRON_SECRET` | Vercel env | browser |
| Backup storage keys, DB URL | GitHub Actions secrets | repo |

- `.env*` is git-ignored, and a names-only `.env.example` is committed.
- Secret scanning runs in CI. A test checks the built client bundle does not contain the Supabase secret key.
- The Supabase secret key is used **only** for: (1) Auth admin calls in user management, (2) the PDF retry cron, and (3) the locally-run `create-first-user` and `recover-owner` scripts. Business writes always use the user's own session.

## 5. File storage
| Bucket | Public? | Contents | Max | Types |
|---|---|---|---|---|
| `payment-proofs` | **Private** | payment and refund screenshots/receipts | 10 MB | jpeg, png, webp, pdf |
| `booking-pdfs` | **Private** | generated statements | 10 MB | pdf |
| `resort-logos` | **Private** | logos | 2 MB | png, jpeg, webp (no SVG, because of XSS risk) |

- Bucket `allowed_mime_types` and `file_size_limit` are set by migration.
- Storage RLS: active users may `SELECT` and `INSERT`. **No UPDATE/DELETE** policies, so files cannot be overwritten or removed.
- Upload paths are generated by the server (`{booking_id}/{uuid}.{ext}`) and handed out as signed upload URLs. The client never picks the path.
- The server verifies the real file type (magic bytes), size and SHA-256 before linking a file.
- Viewing uses **5-minute signed URLs**, created on demand.
- Images are re-encoded in the browser before upload, which removes EXIF/GPS data.
- **Proof rule (Q9, D3):** UPI/Card/Cheque payments and refunds require at least one visible proof. This is enforced in the DB, and the last required proof cannot be hidden.

## 6. Data integrity and audit
- No hard deletes: revoked grants + `prevent_delete` triggers.
- Approved/Rejected/Reversed payments and refunds are immutable except for valid transitions (`approval_guard`).
- Booking Code, Resort and Booking Year are immutable (Q16). Cancelled/no-show cannot be undone.
- Past due payment-plan rows are locked, and expected-collection corrections are append-only dated adjustments with a reason (D2).
- Original booking amounts are never overwritten by cancellation (Q7a). Amount edits need a reason and a new plan (Q13). Manual final-amount adjustments need a reason (Q1).
- Refund limit is checked under a row lock (A − RA − RW).
- **Payment reversal protection (D5):** an approved payment cannot be reversed while approved or waiting refunds depend on it (`REVERSAL_EXCEEDS_REFUNDS`). Reject or reverse the refunds first.
- **Proofs of decided items are locked (Q9a):** files of an approved, rejected or reversed payment/refund cannot be added, hidden or removed. The only exception is the **correction-file process** (PRD FR-PAY-12): approved items only, mandatory written reason (at least 10 characters), original files untouched, labelled "Added after approval", shown on screen, in the PDF, the approval history and the audit log, listed for owner review, and with no effect on any amount or status.
- **Own-email change (O7):** the profile email can change to a new value only (a) by another active user acting on someone else's account (for an Owner account: another Owner under O1), or (b) when it equals the address Supabase Auth has just **confirmed** for that same user, with no session user and nothing else changing. **Editing one's own email directly is refused.** If the profile cannot take the confirmed address, Auth's change is rolled back. Implemented and tested.
- Audit triggers use `auth.uid()` from the verified JWT. Audit, approval history and PDF versions are append-only.
- Self-approval is allowed and always flagged (Q8) on the record, in history and in the audit log.
- Idempotency keys block duplicates. Version checks block lost updates.

## 7. Web application security
- Zod validation on the server + DB constraints.
- Server Actions have built-in Origin/CSRF protection. Route handlers that change data are POST-only, with a session check.
- Headers: CSP (self + Supabase domain), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera allowed for self), HSTS.
- No `dangerouslySetInnerHTML`. React escaping everywhere else.
- CSV exports escape cells starting with `= + - @`.
- User-facing errors never show SQL or stack traces.
- `npm audit` / Dependabot. Lockfile committed.

## 8. Privacy
- Guest mobile numbers and screenshots are personal data. Login is required, and file links are short-lived.
- No analytics or third-party trackers. Logs contain IDs, not names, mobiles or file links.
- Retention: indefinite (no time limit, per requirements).

## 9. Backup and recovery
**Database backups do not include Storage files.** Both are backed up.

| What | How | Frequency | Retention |
|---|---|---|---|
| Postgres (provider-managed) | Daily backups of the paid hosting plan (required for production; budget pending Q11) | Daily | ≥ 7 days |
| Postgres (off-site) | GitHub Actions: `supabase db dump` (roles, schema, data) → gzip → encrypt (owner's public key) → external object storage with versioning/object lock | Daily 02:00 IST | 90 daily + 12 monthly |
| Storage files (all buckets) | Same job: `rclone copy` (never sync/delete) from Supabase S3 endpoint → external storage | Daily | Never deleted |
| Code + migrations | GitHub private repo | Every push | Forever |

- The job records `last_backup_at` and file counts in `system_status`. The dashboard warns when the last backup is more than 36 h old.
- **Restore drill** before go-live and then quarterly (DEPLOYMENT_GUIDE §7–8).

### Migration safety
- Migrations are additive by default. `DROP`, `TRUNCATE`, `DELETE FROM` or `ALTER … TYPE` require a `-- DESTRUCTIVE-APPROVED: <reason>` comment, and a CI script fails otherwise.
- Production migrations run manually, only after a fresh backup, and staging is migrated first. They never run automatically on deploy.

## 10. Security and backup risks
| Risk | Impact | Solution |
|---|---|---|
| Free hosting tiers: no backups, pausing, non-commercial terms | Data loss, downtime, terms violation | Paid plans are a **production requirement**. Budget confirmation deferred to before M10 (Q11). |
| Storage not in DB backups | Lost screenshots | Separate file copy job |
| Service-role key leak | Full DB access | Server-only module, secret scan, bundle check, rotation procedure |
| Owner account takeover / lockout (R16) | Loss of owner control | Last-Owner rule, Owner-only protected actions, password re-entry, alerts, MFA, recovery script. A second Owner is recommended but **pending** (O5); until then see §3.2a for the limitations. |
| Single Owner locked out (O5) | No app-level way to regain Owner access | MFA recovery codes, a controlled mailbox, dashboard-login administrators, tested recovery script (§3.2a) |
| Managers manage other Managers | A Manager locks out colleagues | Self-disable blocked, audit + alert, any user can re-enable |
| Recovery script misuse | Unauthorised Owner reset | Needs the Supabase secret key, which only the business owner controls (MFA on the dashboards). Every run is audited. |
| Shared logins | No accountability | Individual accounts. Disable leavers immediately. |
| Self-approval | Fraud risk | Allowed but flagged everywhere, filter and dashboard count |
| Refund inflation | Money leaving without basis | Limit check, approval required, proof rule, audit |
| Manual adjustment misuse | Hidden discounts | Reason required, adjustment report, shown on the PDF |
| Signed URLs forwarded | File exposure | 5-minute expiry |
| Logo SVG XSS | Script injection | SVG not allowed |
| Large phone photos | Upload failures | Direct signed upload + compression |
| Backup credentials leak | Backup tampering | Write-only keys, versioning/object lock |

## 11. Incident checklist
1. Account misuse: disable the account (a Manager account from any other account; an Owner account from another Owner), sign out its sessions, review Activity.
1a. No Owner can log in: follow DEPLOYMENT_GUIDE §7.4 (Owner account recovery).
2. Leaked key: rotate it in Supabase, update Vercel env, redeploy, review logs.
3. Wrong data: never delete. Correct with an edit (reason), reject, reverse or refund, so the audit trail shows both.

## 12. M2 additions (2026-11-11) — implemented locally, hosted verification pending

### 12.1 Where the secret key is used (complete list)
1. Supabase Auth admin calls for user management (create login, delete a login that the database refused, ban/unban, set a temporary password, change another person's email).
2. "Forgot password": a server-only lookup of `role, is_active` for the typed email, to decide whether to send an email (Owner accounts only). The answer shown is always the same.
3. Removing **one** just-uploaded file that failed the content check and is not saved against any record.
4. The one-time scripts (first Owner, recovery), run on the project owner's own computer.
Never in browser code (the bundle scan checks), never for ordinary reads or writes, never printed or logged.

### 12.2 Rules every database function follows (tests enforce them)
- `SECURITY DEFINER` with an empty `search_path` (ACC-10); the caller comes from `auth.uid()` only, never from a parameter.
- `EXECUTE` is taken from PUBLIC first and granted back only to `authenticated` (ACC-09, SEC-04). PostgreSQL gives PUBLIC execute on new functions by default; migration 08 only handled the functions that existed then.
- Inputs arrive as JSON and are validated field by field (type, range, length, format); an unknown key is ignored; amounts are recalculated by the database.
- Money-changing functions lock the booking row first; the guard triggers re-check every rule underneath (defence in depth).

### 12.3 Things the database cannot do (the server action does) and how they are covered
- **Re-entering the acting Owner's password (O3)**: server action `gate()`, using a separate non-persisting Supabase client. The rule "which actions are protected" is unit-tested (ACU-01..04); the call to the real Supabase Auth is **not yet tested**.
- **Real file type**: the server downloads the uploaded file and checks its first bytes (STO-U1..U4); the database function also compares size and type with what Storage itself recorded (`parse_files`). Whether Supabase Storage names these metadata fields `size` and `mimetype` is **unverified** (the check fails closed, so a wrong guess blocks uploads instead of letting bad files in) — RSV-07.
- **Forced password change**: `complete_password_change` cannot prove a password really changed. It is a reminder for the account holder, not a barrier against themselves.

### 12.4 Known limits and residual risks
- A dev Secret Key was once pasted into a chat. Accepted by the project owner for the dev project; it MUST be replaced before the real Owner is created and before production. The first-Owner script asks about this before it does anything.
- Dev-only advisories: 3 in the `shadcn` command-line tool (devDependency; the fix is a breaking major version). Production dependencies: 0.
- No rate limiting of our own on password re-checks: Supabase Auth's limits apply.
- `GET /auth/blocked` ends the caller's own session (a harmless "sign-out CSRF").
- The built-in Supabase email sender reaches only Supabase-team addresses and is rate-limited; production needs a custom sender (Q11).
- The migrations run on a superuser in my PostgreSQL 17 tests, but as the non-superuser `postgres` on Supabase. Supabase's own settings allow the storage policies and the `auth.users` trigger (verified for 01–10). Migrations 11–16 create only functions, grants and a replaced trigger function, but the first apply is still the real proof.
