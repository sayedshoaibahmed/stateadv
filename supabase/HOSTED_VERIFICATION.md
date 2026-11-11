# Checks on the real Supabase development project

**Nothing in this file has been run yet** (status per check below). Each check says what it needs, exactly what to do, and what a pass looks like. Everything uses fictional data. None of it touches production.

Rules for every check
- Use the development project only. Never print or paste the connection string, the Secret Key or any password into chat, tickets or logs.
- Test accounts use addresses you control (`you+owner-test@…`). Delete nothing: switch test people off instead; the system never deletes records.
- Do not mark a check as passed unless its "pass" line was actually observed.

## 0. Before anything: apply migrations 11–16 (needs your approval)
| Step | Pass |
|---|---|
| `supabase migration list` and `db push --dry-run --skip-vault` | lists exactly migrations 11–16 (**done 2026-11-11**, six files) |
| `db push --skip-vault --yes` (after approval) | six "Applying migration…" lines, exit 0 |
| Read-only: function count | 83 functions in `public`; 37 callable by signed-in users (the list in test SEC-04); only `recover_owner_account` is service-role only; none callable by `anon` |
| Read-only: `db advisors` | no errors or warnings (INFO notes reviewed) |
| Read-only: anonymous REST probe of one new function | HTTP 401/permission denied |

## 1. First Owner (needs approval + replaced Secret Key) — status: not run
1. `npx tsx scripts/create-first-user.ts --dry-run` → "Dry run: nothing was created."
2. After approval: real run in your own terminal. **Pass:** one `user_profiles` row (role owner, active, must change password), one Auth user, one audit row with no actor.

## 2. Sign-in flows (needs the Owner) — status: not run
| # | Do | Pass |
|---|---|---|
| S1 | Sign in with the temporary password | sent to "Choose your own password"; no other page opens |
| S2 | Choose a new password (12+ characters) | lands on the home page; the profile no longer says "must change" |
| S3 | Sign out; open a protected address | back at sign-in; the browser's Back button shows nothing private |
| S4 | Wrong password / wrong email | the same message for both; no hint which one |
| S5 | "Forgot password" with the Owner email | same message as for an unknown address; an email arrives (built-in sender: only Supabase-team addresses) |
| S6 | Open the email link twice | first works; second → "link expired or already used" |
| S7 | Edit the reset link's code | same expired-link message |
| S8 | Wait for the session to expire (or clear the cookies) | next click goes to sign-in, no error page |

## 3. People and Owner rules (needs the Owner + one test Manager) — status: not run
| # | Do | Pass |
|---|---|---|
| U1 | Owner adds a Manager | temporary password shown once; Manager signs in and must change it |
| U2 | Manager adds a Manager | works |
| U3 | Manager tries to add an Owner / promote self / open an Owner's actions | not offered; if forced (direct request) → refused |
| U4 | Owner adds a second Owner with reason + wrong password | refused, nothing created; with the right password → created, notice on everyone's home page |
| U5 | Owner switches off the Manager; the Manager clicks anything | signed out / refused at once; History shows who and when |
| U6 | The only Owner tries to switch themselves off or change their own role | refused with a plain message |
| U7 | With two Owners, each tries to switch the other off at the same moment (two browsers) | exactly one succeeds; one active Owner remains |
| U8 | Owner resets the Manager's password | old password stops working; new temporary password works once |

## 4. Verified email change, O7 (RSV-08; needs two real mailboxes) — status: not run
"Secure email change" must be ON (Auth settings; I will not change it).
| # | Do | Pass |
|---|---|---|
| E1 | My Account → new email + current password | message says links were sent to BOTH addresses; email, profile and audit unchanged |
| E2 | Open only the new-address link | still signs in with the OLD email; profile unchanged |
| E3 | Open both links | signs in with the new email; profile shows it; audit shows old → new with the person as target; Owner notice appears |
| E4 | Wrong current password | refused, no emails |
| E5 | Direct change of the profile email (API/SQL as the person) | refused (`EMAIL_CHANGE_REQUIRES_VERIFICATION`) |

## 5. Money functions through the app or API (needs the Owner, a Manager, one resort) — status: not run
Use `plan_preview`/`create_booking` etc. via the Server Actions once screens exist, or with a signed-in API client. Pass criteria are the same as the PAF/BKF tests: server-built Booking ID, amounts recalculated, plan must balance, waiting refunds change no balance, reversal blocked while refunds depend on it, correction files change no figure. Audit rows carry the real user.

### 5a. Refund limits on the real project (decision 5) — status: not run
With a throw-away booking (amount due 5,000; approved payments 7,000): a running booking accepts refunds up to 2,000 in total (waiting ones count) and refuses the next rupee; after cancelling it with a 5,000 charge the same booking accepts up to 7,000. Two people recording refunds at the same moment never exceed the limit.

## 6. Storage (RSV-07; needs a signed-in user) — status: not run
| # | Do | Pass |
|---|---|---|
| T1 | Request an upload link, upload a small PNG to `payment-proofs`, run the confirm step | file listed with the right size/type; description saved with the payment |
| T2 | Upload a file renamed `.png` that is really HTML | confirm step refuses; the file is removed |
| T3 | Upload 11 MB | refused (Storage limit and our check) |
| T4 | Try to overwrite, update or delete a stored file as an Owner | refused/no effect |
| T5 | Open a file link after 60 seconds | expired |
| T6 | Open a file address directly without a signed link, and as an anonymous visitor | refused |
| T7 | Attach a file that belongs to another booking | refused |
| T8 | **Important:** the database compares a file's size and type with what Storage recorded in `storage.objects.metadata` (`size`, `mimetype`). If every upload is refused at the payment step with "uploaded file does not match", the field names differ — tell me and I will adjust migration 15 before it goes further. |

## 7. IST midnight (RSV-11) — status: not run
The date rules use `Asia/Kolkata` explicitly. A real test needs the hosted clock to cross 00:00 IST: just after midnight check that `today_ist()` shows the new date, a plan row due "yesterday" is locked, and a payment dated "today" is accepted while one dated tomorrow is refused.

## 8. Privileges and advisors after apply (RSV-05, 09, 10)
Re-run the read-only queries and `db advisors` from the first verification; compare with `tests/db/schema-security.test.ts` (SEC-04).
