# DEPLOYMENT_GUIDE — Environments, Setup, Backups and Recovery

| Item | Value |
|---|---|
| Status | PLANNED (M0). Executed in M1 (dev) and M10 (production). |
| Last updated | 2026-11-11 |

## 1. Environments
| Env | Database / Auth / Storage | App hosting | Purpose |
|---|---|---|---|
| Local | `supabase start` (Docker) **or** a free cloud "dev" project | `npm run dev` | development |
| Staging | separate project (free tier OK) | Preview deployments (branch `staging`) | migrations + UAT |
| Production | paid plan, Mumbai region (budget pending Q11) | paid plan, Mumbai function region (pending Q11) | live data |

Local and staging never point at the production database.

## 2. Accounts needed (owned by the owner)
- GitHub: a **private** repository. The owner owns it, and the developer is a collaborator.
- Supabase organisation (owner as Owner).
- Vercel team (owner as Owner).
- External object storage for off-site backups (e.g. Backblaze B2 or AWS S3). The provider is not final (Q11).
- Optional: a domain name.

Credentials stay with the owner. The developer gets limited access.

## 3. Environment variables
| Name | Scope | Note |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client + server | publishable key (sb_publishable_…) |
| `SUPABASE_SECRET_KEY` | **server only** (sb_secret_…) | used only for Auth admin (user management) and the PDF cron |
| `APP_TIMEZONE` | server | `Asia/Kolkata` |
| `CRON_SECRET` | server | random 32+ chars |
| GitHub Actions secrets: `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_S3_ACCESS_KEY` / `SECRET`, `BACKUP_STORAGE_KEY_ID` / `SECRET`, `BACKUP_ENCRYPTION_PUBLIC_KEY` | CI only | backup job |

`.env.example` lists the names only. `lib/env.ts` validates them at startup.
The booking ID needs no env var: the prefix is each resort's code, stored in the DB.

## 4. Supabase setup checklist
1. Create the project (Mumbai region). Keep the DB password in a password manager.
2. Auth:
   - Email provider on.
   - **Sign-ups disabled.**
   - Leaked-password protection on (if the plan allows).
   - **Secure email change ON** (old and new address both confirm). Confirmation links are single-use and short-lived. In development the built-in Supabase email may deliver only to your Supabase team addresses, so test email changes with those.
   - JWT expiry 3600.
   - Site URL and redirect URLs set to the app domain.
3. `supabase link --project-ref <ref>`. Apply migrations (§6).
4. Check in the dashboard that every bucket is **not public**.
5. Create the **first user** with the one-time script `scripts/create-first-user.ts` (run locally with the Supabase secret key). It creates an auth user + profile with `must_change_password`. All later users are added in the app (Settings → Users).
6. SSL enforcement on. Network restrictions optional.
7. Production: confirm daily backups are visible on the paid plan. PITR is optional (Q11).

## 5. Vercel setup checklist
1. Import the GitHub repo (Next.js preset, Node LTS).
2. Env vars separately for Production and Preview (Preview → staging Supabase).
3. Function region Mumbai. PDF routes run on the default Node.js runtime (no `runtime` export — not allowed with Cache Components); set `maxDuration` 30–60 s.
4. `vercel.json` cron: `/api/cron/pdf-retry` every 10 min (`CRON_SECRET`).
5. Domain + HTTPS. Deployment Protection on Preview.

## 6. Release and migration procedure
1. PR → CI (lint, typecheck, unit, DB tests, migration-safety, secret scan).
2. Merge to `staging` → preview deploy → `supabase db push` to **staging** → smoke test.
3. Production:
   1. Run the backup job manually and confirm success.
   2. `supabase db push` to production, after reviewing the list of pending migrations.
   3. Merge to `main` → production deploy.
   4. Smoke test: login, dashboard, open a booking, open a screenshot, download a PDF, open the Users page.
4. Rollback:
   - Code: Vercel Instant Rollback.
   - Database: a forward fix migration only, never a destructive "down" migration.

**Production migrations never run automatically from CI.**

## 7. Backups and recovery

### 7.1 Daily backup job (GitHub Actions, 02:00 IST = 20:30 UTC)
1. `supabase db dump` (roles, schema, data as separate files).
2. gzip + encrypt with the owner's public key. The private key is held offline by the owner.
3. Upload to external storage `db/YYYY/MM/DD/` (versioning + object lock).
4. `rclone copy` (never `sync`) of all buckets: `payment-proofs`, `booking-pdfs`, `resort-logos`.
5. Record counts and time in `system_status`. The dashboard warns if the backup is more than 36 h old.
6. On failure, GitHub notifies the owner and developer.

### 7.2 Restore procedure (also used for drills)
1. New Supabase project (scratch for a drill, replacement for a disaster).
2. Download and decrypt the latest dump.
3. Restore roles → schema → data (`session_replication_role = replica` during the data load).
4. Recreate the buckets via migration and copy the files back with `rclone copy`.
5. Run `scripts/verify-restore.sql`:
   - row counts;
   - Σ approved payments and Σ approved refunds per resort;
   - proofs vs storage objects;
   - 10 random proofs open;
   - latest PDF versions exist;
   - `auth.users` vs `user_profiles` match.
6. Disaster case: point the Vercel env vars at the new project and redeploy.
7. Record the result in §8.

### 7.3 Smaller cases
| Situation | Action |
|---|---|
| Wrong data entered | No restore. Correct in the app (edit with reason / reject / reverse / refund). |
| Bad migration, data intact | Forward fix migration |
| Recent data loss | Provider backup/PITR (take a fresh dump first) |
| A missing file | Copy it back from external storage by path |
| Someone disabled many Managers | Any active user re-enables them. Review Activity. |
| No Owner can log in | §7.4 |

### 7.4 Owner account recovery
Use this in order, and stop at the first step that works:
1. **Another Owner** resets the password or re-enables the account (Settings → Users; needs a reason and their own password). *Only possible once a second Owner exists. With one Owner, go straight to step 2.*
2. **Forgot password email** (Owner accounts only) from the login page. This requires the production email sender (custom SMTP) to be configured.
3. **Recovery script** (last resort), run by the business owner (or the developer in the owner's presence) on a trusted computer:
   1. Log in to the Supabase dashboard (owner's account, MFA) → copy the Supabase secret key into a temporary local `.env.recovery` (never commit it).
   2. `npx tsx scripts/recover-owner.ts --email owner@example.com --reason "Lost phone and password"`.
   3. The script re-enables the Owner profile, removes the Auth ban, sets a temporary password (printed once), removes a lost MFA device if `--reset-mfa` is given, and records audit action `owner_recovered`. It never creates a new Owner and never lets the active-Owner count drop below one.
   4. Delete `.env.recovery`. Log in and change the password. Consider rotating the Supabase secret key afterwards (Vercel env update + redeploy).
4. Afterwards, review Activity for account actions around the incident.

Prevention: add a second Owner as soon as possible, keep MFA on every Owner account with recovery codes stored offline, and keep the Supabase/Vercel dashboard logins with the business owner (MFA on).

### 7.5 While there is only one Owner (O5)
The system runs securely with a single Owner, with a narrower recovery path. Full table: SECURITY.md §3.2a.
- Managers **cannot** reset or re-enable the Owner (by design, O1).
- If the Owner forgets the password, the "Forgot password" email is the only self-service route. It needs a mailbox the Owner controls and a working email sender. In development the built-in Supabase sender is rate-limited and may only deliver to Supabase team members' addresses.
- If the mailbox or MFA device is also lost, only the recovery script (step 3 above) works. It needs the Supabase dashboard login.
- The Owner can change their **own** login email in the app (My Account), with password + confirmation of the new address (and the old one). That needs working email delivery. Role changes are never self-service.
- To add the second Owner later: Settings → Users → Add User → role Owner (reason + password re-entry). No development work or deployment is needed.

## 8. Restore drill log
| Date | Backup used | Result | Duration | Notes | By |
|---|---|---|---|---|---|
| — | — | — | — | first drill planned in M9 | — |

## 9. Hosting costs — ESTIMATE ONLY, NOT FINALISED (Q11 deferred)
**No subscriptions will be bought and no provider is final until the owner confirms the budget before M10.** Development (M1–M9) runs on free tiers.

**Production requirements** (whatever the provider):
1. Automatic daily database backups with at least 7 days retention.
2. No automatic pausing of the database.
3. Terms that allow commercial/business use.
4. An India (Mumbai) region.
5. Off-site backup storage with versioning for DB dumps and all files.
6. Private file storage with signed URLs.

Estimate for the planned stack (prices change; recheck at signup):

| Service | Plan | Approx. monthly |
|---|---|---|
| Supabase | Pro | ~US$25 (PITR add-on extra, optional) |
| Vercel | Pro (1 seat) | ~US$20 |
| Off-site backup storage | pay-per-use | ~US$1–5 |
| Email sender (SMTP) for Owner password-reset links | free tier of a transactional email provider is usually enough | ~US$0–15 |
| Domain | — | ~US$1 |
| **Total** | | **~US$47–66** |

## 10. Go-live checklist (M10)
- [ ] All M9 tests pass. Restore drill done.
- [ ] Owner confirmed the hosting budget and providers (Q11).
- [ ] Production on paid plans. Backups visible. Sign-ups disabled.
- [ ] Buckets private (verified).
- [ ] Service-role key only in the production server env.
- [ ] First backup + file copy succeeded.
- [ ] User accounts created, passwords changed at first login.
- [ ] Owner account has MFA on, with recovery codes stored offline.
- [ ] Second Owner added (recommended), **or** the owner has signed off on the one-Owner limitations (SECURITY.md §3.2a) and the decision is recorded in PROGRESS.md.
- [ ] Owner reset email tested. Recovery script tested on staging.
- [ ] Real resorts entered with codes and logos.
- [ ] Owner explicitly approved the production deployment.

## 12. M2 operating instructions (2026-11-11)

### 12.1 Applying migrations (development project) — only after the owner's approval each time
1. `npx supabase migration list --remote=<url>` and `db push --dry-run --skip-vault --remote=<url>` — the dry run must list exactly the expected files.
2. After approval: `db push --skip-vault --yes --remote=<url>`. Each file is one transaction; a failure leaves the earlier files applied and records nothing for the failed one. There is no "down" migration: undoing means a database reset, which needs separate approval.
3. Afterwards, read-only checks: migration history, counts of tables/functions/policies/triggers, privileges (SEC-04 list), `db advisors`.
4. Keep the connection string only in `.env.local`; never paste it into chat, issues or logs. Reset the database password and remove the variable when this work is finished.

### 12.2 Creating the first Owner — once, with explicit approval
1. Replace the dev Secret Key (Supabase dashboard → Project Settings → API Keys): create a new one, delete the old one, put the new one into `.env.local` yourself.
2. `npx tsx scripts/create-first-user.ts --dry-run` — checks everything, creates nothing.
3. `npx tsx scripts/create-first-user.ts` — in your own terminal window. It asks for the Owner's name and email, then the temporary password through a hidden prompt, then `CREATE OWNER`. It refuses to run if any account exists. The Owner must choose a new password at the first sign-in.

### 12.3 Adding people (Settings → People)
- A Manager can add, edit, switch off/on and reset the password of **Managers**. Only an Owner can add an Owner, promote someone to Owner, or do anything to an Owner account; those actions need a written reason (10+ characters) and the acting Owner's own password, and appear as a notice on everyone's home page.
- The temporary password is shown **once** on screen. Give it to the person privately.
- Two Owners are recommended (O4/O6). While only one exists, Owners see a notice.

### 12.4 Recovery (no Owner can sign in)
1. "Forgot password" on the sign-in page (Owner accounts only).
2. Another Owner resets the password (People → the person → Reset password).
3. Last resort, on the project owner's own computer: `npx tsx scripts/recover-owner.ts --dry-run`, then without `--dry-run` (add `--reset-mfa` to remove a lost two-step device). It switches the account on, sets a temporary password (shown once) and writes `owner_recovered` with your reason.

### 12.5 Email
The built-in Supabase email sender delivers only to Supabase-team addresses and is rate-limited. Sign-in and temporary passwords do not depend on email. "Forgot password" and the verified email change do; production needs a custom SMTP sender (Q11). "Secure email change" must stay ON.

### 12.6 Real-system checks
`supabase/HOSTED_VERIFICATION.md` lists each check, what it needs, and what a pass looks like. None of them has been run yet.
