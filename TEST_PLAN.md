# TEST_PLAN — Testing Strategy and Key Test Cases

| Item | Value |
|---|---|
| Status | M0 final draft (aligned with PRD §5.11–5.12 and DATABASE_SCHEMA §4) |
| Last updated | 2026-11-11 |

## 1. Strategy
| Level | Tool | Scope | When |
|---|---|---|---|
| Unit | Vitest | money parse/format, IST dates and nights, Zod schemas, live calculation preview, PDF data mapping + hash, CSV escaping, warning logic | every commit |
| Database | pgTAP (`supabase test db`) | constraints, triggers, RLS, RPCs, financial views, report functions, concurrency | every commit (CI with Docker) |
| Integration | Vitest + local Supabase | Server Action → RPC → Storage; user management (Auth admin + profile RPC) | per milestone |
| E2E | Playwright (desktop Chromium, Pixel 5, iPhone 12) | the flows in UI spec §4 | per milestone + before deploy |
| Manual / UAT | checklist | language, PDF look, real phones | M9, M10 |
| Security | scripts + review | RLS bypass, headers, secrets, dependencies | M9 + each release |
| Restore drill | runbook | backup → restore → verify | before go-live, then quarterly |

**M2 status (2026-11-11):** database tests run today with **PGlite** (real PostgreSQL 18 compiled to WebAssembly, in memory, no Docker, never connected to Supabase) via `npm run test:db` and in CI through `npm test`: 143 tests in `tests/db`. They cover SEC-01..05, USR/OWN single-connection cases, AMT, CO, BID (non-concurrent), PLN, CAN, PAY, APR, REF, AUD, FIN-01..19 plus 250 random bookings against `src/lib/calc.ts`, COL-01/05/06/10/11*. `npm run check:mutations` deliberately weakens the migrations in 10 ways and requires the tests to fail each time. **Still to do (later in M2, GitHub Actions on real Postgres):** tests that need several simultaneous connections (BID-02/03, OWN-06, REF-04 race, APR-05), the RPC tests (when the write functions exist), and pgTAP-style checks against the Supabase-managed pieces.

**Golden fixture:** `supabase/tests/fixtures/golden.sql` with 3 resorts, about 40 bookings (both pricing methods, extras, discounts, adjustments, cancellations, no-shows) and about 100 payments/refunds in every status. `golden_expected.csv` holds the hand-calculated figures. The dashboard, reports and PDF summaries are asserted against it.

Tests never run against production, and **no test data is ever left in the real development or production project** (O5):
- Ordinary database tests (pgTAP) create their users and rows inside a transaction that is rolled back.
- Concurrency tests (BID-02/03, OWN-06, REF-04, APR-05) must commit data from several connections. They run **only in a disposable database** (the local Supabase stack that CI starts, created fresh for each run and thrown away), never in the cloud dev, staging or production project.

## 2. Test cases

### 2.1 Money (unit)
| ID | Case | Expected |
|---|---|---|
| MON-01 | parse "2500" | 250000 |
| MON-02 | parse "2,500.50" / "2500.5" | 250050 |
| MON-03 | parse "1,50,000" | 15000000 |
| MON-04 | "0.1" + "0.2" | exactly 30 paise |
| MON-05 | "12.345", "-5", "abc", "", "1e5" | validation error |
| MON-06 | format 15000000 | "₹1,50,000" |
| MON-07 | format 250050 | "₹2,500.50" |
| MON-08 | very large (₹99,99,99,999) | exact |

### 2.2 Booking amount (unit + DB) — Q1, Q14, D4
| ID | Case | Expected |
|---|---|---|
| AMT-01 | per stay: 2 × ₹2,500 | base ₹5,000, final ₹5,000 |
| AMT-02 | per night: 2 × ₹2,500 × 2 nights + extra ₹500 − discount ₹1,000 | total ₹10,500, final ₹9,500 |
| AMT-03 | nights from dates: in 12 Nov 14:00, out 14 Nov 11:00 IST | 2 nights |
| AMT-04 | per night with same-day check-out (0 nights) | rejected |
| AMT-05 | per stay with 0 nights (day outing) | allowed |
| AMT-06 | discount > total | rejected |
| AMT-07 | discount as % input | not possible (rupee only) |
| AMT-08 | manual final ₹9,000 without reason | rejected |
| AMT-09 | manual final ₹9,000 with reason | adjustment −₹50,000 paise, final ₹9,000, audit entry |
| AMT-10 | manual final below ₹0 | rejected |
| AMT-11 | client sends a tampered base/final | server recomputes; CHECK on base enforces the formula |
| AMT-12 | IST boundary: check-in 23:30, check-out next day 00:30 | 1 night |

### 2.3 C/O and stay types — Q2, Q3
| ID | Case | Expected |
|---|---|---|
| CO-01 | Agent without agent | rejected |
| CO-02 | Agent with a partner record | rejected |
| CO-03 | Partner without partner | rejected |
| CO-04 | Own without name | rejected |
| CO-05 | Own with name | saved |
| CO-06 | Direct with a name or agent id | rejected |
| ST-01 | seed contains Resort Stay, Day Outing, Package | ✓ |
| ST-02 | add new stay type / deactivate | new one selectable; deactivated one hidden in the form but still shown on old bookings |

### 2.4 Booking ID — Q4, Q16
| ID | Case | Expected |
|---|---|---|
| BID-01 | first 2026 booking for RSA, then DRI | `RSA-2026-000001`, `DRI-2026-000001` |
| BID-02 | 50 concurrent creates, same resort/year | 50 unique consecutive numbers, no errors |
| BID-03 | 25 RSA + 25 DRI concurrently | each 000001–000025 |
| BID-04 | forced failure after the number is taken | counter rolled back. The number is never used by a saved booking. |
| BID-05 | booking date 30 Dec 2026 entered 5 Jan 2027 | next `RSA-2026-…` |
| BID-06 | first booking with a 2027 booking date | `RSA-2027-000001` |
| BID-07 | cancelled booking | ID kept, never re-issued |
| BID-08 | update booking_code / booking_seq | blocked |
| BID-09 | change resort on edit | blocked (`ID_FIELDS_LOCKED`) |
| BID-10 | change booking date to another year | blocked |
| BID-11 | change booking date within the same year | allowed, audited |
| BID-12 | change resort code after bookings exist | blocked |

### 2.5 Booking edit and payment plan — Q6, Q6b, Q13
| ID | Case | Expected |
|---|---|---|
| PLN-01 | new booking form | Advance due = booking date, Balance due = check-in, **both amounts empty** |
| PLN-02 | plan total ≠ final | save blocked (`PLAN_TOTAL_MISMATCH`) |
| PLN-03 | user edits due dates / adds 3rd row | saved |
| PLN-04 | no code path generates a % or fixed advance | asserted (unit + E2E) |
| PLN-05 | update or supersede a row with due_date < today (via RPC or direct SQL) | blocked (`PAST_DUE_ROW_LOCKED`) |
| PLN-06 | new row with a past due date on a later revision | rejected |
| PLN-07 | first revision (creation) with a past due date | allowed |
| PLN-08 | to_plan < 0 | adjustment = to_plan, dated today, reason stored. New rows refused. |
| PLN-09 | update/delete expected_adjustments or plan revisions | denied |
| PLN-10 | row due **today** at the time of change | treated as not yet past (can be replaced) |
| PLN-11 | plan change at 23:59 vs 00:01 IST | lock decision uses the IST date in the DB |
| EDT-01 | amount change without reason | rejected |
| EDT-02 | amount change without a new plan | rejected |
| EDT-03 | amount change with reason + plan after approved payments | saved. Old plan superseded. Payments unchanged (byte-for-byte). New PDF version. |
| EDT-04 | new final below approved | Refund due shown, Pending 0 |
| EDT-05 | stale version | `STALE_RECORD` |
| EDT-06 | double-submit create (same idempotency key) | one booking |
| EDT-07 | guest name changed later | booking snapshot unchanged |
| EDT-08 | edit amounts on a cancelled booking | blocked |

### 2.6 Payments and approvals — Q8, Q9
| ID | Case | Expected |
|---|---|---|
| PAY-01 | add cash payment without proof | saved, waiting |
| PAY-02 | add UPI / Card / Cheque payment without proof | rejected (`PROOF_REQUIRED`) |
| PAY-03 | "Other" without proof | saved |
| PAY-04 | hide the only proof of a UPI payment | blocked |
| PAY-05 | amount ≤ 0 / future date | rejected |
| PAY-06 | backdated 2 years | allowed; recorded_at = now |
| PAY-07 | duplicate reference / duplicate sha256 | saved with warning |
| PAY-08 | above Amount Due | saved with warning |
| PAY-09 | disguised file / > 10 MB | rejected |
| PAY-10 | provider/method mismatch | rejected |
| APR-01 | approve | fields set, history row |
| APR-02 | reject without reason | rejected |
| APR-03 | reverse approved with reason | reversed, excluded from totals |
| APR-04 | invalid transitions | error |
| APR-05 | concurrent approve | one succeeds, the other gets `ALREADY_DECIDED` with a name |
| APR-06 | self-approval | allowed; `is_self_approved`, `is_self_action`, audit, "Self-approved" on screen and PDF |
| APR-07 | edit approved payment (direct SQL as authenticated) | denied |
| APR-08 | update/delete approval_history | denied |

### 2.7 Cancellation and no-show — Q7, Q7a, Q7c
| ID | Case | Expected |
|---|---|---|
| CAN-01 | cancel without reason / date / charge | rejected (no default charge) |
| CAN-02 | charge < 0 or > final | rejected |
| CAN-03 | cancel with charge ₹1,000 (no past due rows) | original total/discount/final unchanged; amount_due = 1,000; future rows superseded; cancellation plan = 1,000; audit; new PDF |
| CAN-03b | cancel when past due rows exceed the charge | past rows kept; negative adjustment dated today with the cancellation reason |
| CAN-03c | cancellation date in the future | rejected |
| CAN-04 | cancel with charge ₹0 | amount_due 0, no active plan rows, expected 0 |
| CAN-05 | no-show form | charge pre-filled = final |
| CAN-06 | no-show with changed charge but no charge-change reason | rejected |
| CAN-07 | no-show with changed charge + reason | saved |
| CAN-08 | reactivate a cancelled booking | blocked |
| CAN-09 | correct the charge later without reason | rejected; with reason → new cancellation plan, audit, new PDF |
| CAN-10 | expected collection after cancellation | from the cancellation date onwards, total expected = charge; the original amount is no longer expected; past months unchanged (D2) |

### 2.8 Refunds — Q7b, Q7d, Q12, D1, D3
| ID | Case | Expected |
|---|---|---|
| REF-01 | refund on a cancelled booking within the limit | saved, waiting |
| REF-02 | refund on an overpaid active booking | saved |
| REF-03 | refund > A − RA − RW | rejected (`REFUND_TOO_LARGE`) |
| REF-04 | two concurrent refunds together exceeding the limit | one succeeds, one rejected |
| REF-05 | refund larger than Refund due but within the limit | saved with warning |
| REF-06 | UPI refund without proof | rejected (D3) |
| REF-07 | approve / reject / reverse refund | history, audit, self-approved flag |
| REF-08 | waiting refund | changes **no** balance (Pending, Verified Remaining, Extra, Refund due, Total/Net Collection) (D1). Shown only as "Refunds Waiting for Approval". Lowers "Refund still to record" and the refund limit. |
| REF-08b | refund limit with a waiting refund | a second refund cannot exceed A − RA − RW (no double refund) |
| REF-09 | approved refund | Net Collection = A − RA |
| REF-10 | delete/edit a decided refund | denied |

### 2.9 Financial view (golden), Amount Due = D
| ID | Scenario | A | W | RA | RW | Pending | Verified Rem. | Extra | Refund due | Total Coll. | Net Coll. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FIN-01 | D 5,000, nothing paid | 0 | 0 | 0 | 0 | 5,000 | 5,000 | 0 | 0 | 0 | 0 |
| FIN-02 | 1,500 W + 3,500 W | 0 | 5,000 | 0 | 0 | 0 | 5,000 | 0 | 0 | 0 | 0 |
| FIN-03 | 1,500 A + 3,500 W | 1,500 | 3,500 | 0 | 0 | 0 | 3,500 | 0 | 0 | 1,500 | 1,500 |
| FIN-04 | 1,500 rejected + 3,500 W | 0 | 3,500 | 0 | 0 | 1,500 | 5,000 | 0 | 0 | 0 | 0 |
| FIN-05 | 5,000 A | 5,000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5,000 | 5,000 |
| FIN-06 | 5,000 A + 1,000 W | 5,000 | 1,000 | 0 | 0 | 0 | 0 | 1,000 | 0 | 5,000 | 5,000 |
| FIN-07 | 6,000 A | 6,000 | 0 | 0 | 0 | 0 | 0 | 1,000 | 1,000 | 6,000 | 6,000 |
| FIN-08 | FIN-07 + refund 1,000 W (D1: waiting refund changes nothing except "Refund still to record" → 0) | 6,000 | 0 | 0 | 1,000 | 0 | 0 | 1,000 | 1,000 | 6,000 | 6,000 |
| FIN-09 | FIN-07 + refund 1,000 A | 6,000 | 0 | 1,000 | 0 | 0 | 0 | 0 | 0 | 6,000 | 5,000 |
| FIN-10 | 2,000 A reversed + 2,000 A | 2,000 | 0 | 0 | 0 | 3,000 | 3,000 | 0 | 0 | 2,000 | 2,000 |
| FIN-11 | Final 5,000, 3,000 A, cancelled, charge 1,000 → D 1,000 | 3,000 | 0 | 0 | 0 | 0 | 0 | 2,000 | 2,000 | 3,000 | 3,000 |
| FIN-12 | FIN-11 + refund 2,000 A | 3,000 | 0 | 2,000 | 0 | 0 | 0 | 0 | 0 | 3,000 | 1,000 |
| FIN-13 | no-show, charge 5,000, 1,000 A | 1,000 | 0 | 0 | 0 | 4,000 | 4,000 | 0 | 0 | 1,000 | 1,000 |
| FIN-14 | cancelled, charge 0, nothing paid | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| FIN-15 | Final edited 5,000 → 4,000 after 5,000 A | 5,000 | 0 | 0 | 0 | 0 | 0 | 1,000 | 1,000 | 5,000 | 5,000 |
| FIN-16 | D 5,000, 6,000 A, refund 1,500 **W** | 6,000 | 0 | 0 | 1,500 | **0** | 0 | 1,000 | 1,000 | 6,000 | 6,000 |
| FIN-17 | FIN-16 refund **approved** | 6,000 | 0 | 1,500 | 0 | **500** | 500 | 0 | 0 | 6,000 | 4,500 |
| FIN-18 | FIN-11 + refund 2,000 W | 3,000 | 0 | 0 | 2,000 | 0 | 0 | 2,000 | 2,000 (still to record 0) | 3,000 | 3,000 |
| FIN-19 | FIN-18 refund rejected | 3,000 | 0 | 0 | 0 | 0 | 0 | 2,000 | 2,000 (still to record 2,000) | 3,000 | 3,000 |

### 2.10 Expected vs actual (golden)
| ID | Case | Expected |
|---|---|---|
| COL-01 | plan 1,500 due 1 Nov + 3,500 due 20 Nov; November | Expected 5,000 |
| COL-02 | paid 30 Oct, approved 2 Nov | October collection (payment date) |
| COL-03 | waiting payments | never in Total Collection / Net. Shown as Waiting. |
| COL-04 | plan changed twice | only active rows count |
| COL-05 | advance paid before due | Difference and Overdue both correct |
| COL-06 | overdue allocation (partial) | oldest-due-first |
| COL-07 | resort filter | all-resort total = sum of the resorts |
| COL-08 | payment dated 1 Dec, entered 30 Nov 23:50 IST | December |
| COL-09 | rejected/reversed | never counted |
| COL-10 | refund approved 5 Dec for a November payment | November collection unchanged; December refunds +; December net − |
| COL-11 | Advance 2,000 due 1 Oct + Balance 3,000 due 1 Dec; cancelled 10 Nov, charge 1,000 | Oct **2,000 (unchanged)**, Nov −1,000 adjustment (reason, date 10 Nov), Dec 0. Σ = 1,000. (D2) |
| COL-11b | same, charge 3,000 | Oct 2,000, Nov +1,000 cancellation row, Dec 0. No adjustment. |
| COL-11c | move unpaid Oct 2,000 to 15 Dec on 10 Nov | Oct 2,000, Nov −2,000, Dec +2,000. Overdue on 10 Nov = 0. |
| COL-11d | amount reduced on 10 Nov (discount 1,000) with Oct row past | Oct unchanged. Future rows re-planned, or a −adjustment if the future rows are not enough. |
| COL-11e | Expected report run before and after a later cancellation, for a past month | identical figures for the past month |
| COL-11f | invariant Σ active rows + Σ adjustments = amount due for every golden booking | ✓ |
| COL-12 | dashboard Total Collection (Approved) card = report total for the same filters | ✓ |

### 2.11 Users and security — Q10
| ID | Case | Expected |
|---|---|---|
| USR-01 | manager adds a user | auth user + profile created, `must_change_password`, audit `user_created` |
| USR-02 | new user's first login | forced to change password |
| USR-03 | manager disables another **Manager** | allowed; user blocked immediately (RLS) and banned; audit |
| OWN-01 | manager disables / resets password / changes email or role of an **Owner** | blocked (`OWNER_ACTION_REQUIRES_OWNER`) in the Server Action and in direct RPC/SQL |
| OWN-02 | manager promotes self or another user to Owner, or creates an Owner | blocked |
| OWN-03 | Owner A disables Owner B (2 active Owners) with reason + correct password | allowed; audit; dashboard alert |
| OWN-04 | the same with a wrong password or no reason | blocked (`PASSWORD_CONFIRM_FAILED` / reason required) |
| OWN-05 | disable or demote the **last** active Owner | blocked (`LAST_OWNER_PROTECTED`) |
| OWN-06 | two Owners disable each other at the same moment | at most one succeeds; ≥ 1 active Owner remains |
| OWN-07 | Owner forgot password: "Forgot password" link | email sent for Owner accounts only; no link for Managers |
| OWN-08 | recovery script with the service role | Owner re-enabled / temporary password; audit `owner_recovered` with reason |
| OWN-09 | `recover_owner_account` called by an authenticated user | denied |
| OWN-10 | Auth admin call fails after the RPC succeeded | compensated; profile and Auth state consistent |
| OWN-11 | system with exactly one active Owner: the Owner disables or demotes self | blocked |
| OWN-12 | one Owner: a Manager tries to disable, reset, re-email or demote the Owner, or to promote self to Owner | blocked at the Server Action, RPC and direct SQL |
| OWN-13 | one Owner: Owner adds a user with role Owner, with reason and correct password | allowed; audit + alert; two active Owners |
| OWN-14 | Add Owner without a reason or with a wrong password | blocked |
| OWN-15 | `create-first-user` when a profile already exists | refuses and creates nothing |
| OWN-16 | `create-first-user` on an empty system | creates exactly one Owner profile + Auth user, `must_change_password` set |
| OWN-17 | one active Owner: notice shown on the dashboard and Users page; hidden once a second Owner exists | ✓ |
| OWN-18 | recovery script with `--reset-mfa` on the sole Owner | MFA factor removed, account usable, audit `owner_recovered`, still exactly one Owner |
| OWN-19 | the database after all tests contains no test or placeholder Owner | ✓ (tests roll back) |
| USR-04 | user disables self (UI, Server Action, direct RPC) | blocked at every layer (`CANNOT_DISABLE_SELF`) |
| USR-05 | reset password | temporary password set, must change, audit (no password in log) |
| USR-06 | re-enable user | allowed, audit |
| USR-07 | disabled user with a still-valid JWT | all reads/RPCs denied |
| USR-08 | names shown (not emails) across the UI and PDFs | ✓ |
| SEC-01 | anon key: select any table | denied/empty |
| SEC-02 | authenticated direct INSERT/UPDATE/DELETE via REST | denied |
| SEC-03 | every public table has RLS | ✓ |
| SEC-04 | internal functions not executable | ✓ |
| SEC-05 | storage anon access / overwrite / delete | denied |
| SEC-06 | signed URL after 5 min | expired |
| SEC-07 | Supabase secret key absent from the client bundle | ✓ |
| SEC-08 | CSV formula injection | escaped |
| SEC-09 | security headers | present |

### 2.12 Audit
| ID | Case | Expected |
|---|---|---|
| AUD-01 | each RPC writes an audit row with the correct actor, old/new and reason | ✓ |
| AUD-02 | audit rows cannot be updated/deleted | ✓ |
| AUD-03 | account actions include target_user_id | ✓ |
| AUD-04 | Activity page shows readable diffs | ✓ |

### 2.13 PDF versioning
| ID | Case | Expected |
|---|---|---|
| PDF-01 | create booking | v1 |
| PDF-02 | add payment / approve / reject / reverse | new version each time the printed data changes |
| PDF-03 | add refund / approve refund | new version |
| PDF-04 | booking edit, plan change, cancel, no-show, charge change | new version |
| PDF-05 | an action that changes nothing printed | no new version |
| PDF-06 | contents: pricing method, nights, extra, discount, adjustment + reason, plan, payments, refunds, cancellation block, totals, self-approved marks, version and date, disclaimer | ✓ (snapshot + visual check) |
| PDF-07 | ₹ and Indian grouping render | ✓ |
| PDF-08 | generator throws | data saved, job failed, retry succeeds |
| PDF-09 | download an old version | works via signed URL |

### 2.13a Decisions of 2026-11-11 (O7, Q9a, D5) — to be written with the matching migration changes
| ID | Case | Expected |
|---|---|---|
| EML-01 | an Owner (or Manager) asks to change their own email | nothing changes in `auth.users` or `user_profiles` until the confirmation link(s) are used |
| EML-02 | the wrong current password is given | request refused, nothing sent |
| EML-03 | the confirmed address arrives (simulated change of `auth.users.email`) | `user_profiles.email` takes exactly that address; audit row with old and new; alert raised |
| EML-04 | direct attempt to set a different email on a profile (own account, with or without a session) | refused (`OWNER_ACTION_REQUIRES_OWNER` for Owners, `NOT_ALLOWED` otherwise) |
| EML-05 | the sync flag set by a normal logged-in user | does not allow any change (it only works with no session user and a matching confirmed address) |
| EML-06 | the sole Owner changes their own **role** (any route) | refused |
| EML-07 | another Owner changes an Owner's email (O1 route) | still works with reason + password re-entry |
| EML-08 | `auth.users` email and `user_profiles` email differ after a test | nightly integrity check reports it |
| COR-01 | add a correction file to an **Approved** payment with a reason of 10+ characters | accepted; tagged "Added after approval"; audit row; no amount/status/date changes |
| COR-02 | the same without a reason or with a short one | refused (`proofs` CHECK) |
| COR-03 | add a correction file to a Waiting, Rejected or Reversed payment | refused (Waiting uses the normal add; others need a new payment) |
| COR-04 | hide, edit or replace any original or correction file of an Approved payment | refused (`PROOF_LOCKED`) |
| COR-05 | correction file for an Approved refund | same rules as payments |
| COR-06 | correction file changes `booking_financials` | never; all figures identical before and after |
| COR-07 | correction file appears in the "Corrections added after approval" list and on the booking PDF | ✓ |
| REV-01 | reverse an approved payment while approved refunds depend on it | refused (`REVERSAL_EXCEEDS_REFUNDS`) — already covered by the existing database test |
| REV-02 | the same while a refund is only **waiting** | refused; allowed once that refund is rejected |
| REV-03 | reverse after the dependent refund was reversed | allowed |

### 2.14 UI / E2E
Flows F1–F10 (UI spec §4) on desktop and mobile. Plus: keyboard-only booking creation, a throttled network during upload, the offline banner, plain-English errors, and the dashboard showing exactly one Total Collection (Approved) card and a separate Waiting card (Q17).

### 2.15 Backup / restore
| ID | Case | Expected |
|---|---|---|
| BKP-01 | nightly job | dump + files stored, `system_status` updated |
| BKP-02 | restore drill | counts and approved/refund totals match, random proofs open |
| BKP-03 | migration containing DROP without the approval comment | CI fails |

## 3. Exit criteria per milestone
- No failing tests. New code has relevant tests.
- Financial, refund, cancellation and security tests have **no skips**.
- Results are summarised in PROGRESS.md and the milestone report.
