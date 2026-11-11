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

### 2.13a Decisions of 2026-11-11 (O7, Q9a, D5)
**Status:** database level IMPLEMENTED and passing (27 tests in `tests/db/email-change-and-corrections.test.ts`, plus 18/18 mutation catches). Rows marked *app level* need the screens and the real Supabase Auth emails and are tested later in M2 / on the real project.
| ID | Case | Expected |
|---|---|---|
| EML-01 | an Owner (or Manager) asks to change their own email | *app level:* nothing changes in `auth.users` or `user_profiles` until the confirmation link(s) are used (database side: the profile never changes except by the sync) |
| EML-02 | the wrong current password is given | *app level:* request refused, nothing sent |
| EML-03 | the confirmed address arrives (simulated change of `auth.users.email`) | ✅ `user_profiles.email` takes exactly that address (lower-cased); only the email changes; audit row with old and new; *alert: app level* |
| EML-04 | direct attempt to set a different email on a profile (own account, with or without a session) | ✅ refused (`EMAIL_CHANGE_REQUIRES_VERIFICATION` for the account itself, `NOT_ALLOWED` with no session) |
| EML-05 | the sync flag set by anyone | ✅ allows nothing beyond copying the address Auth confirmed for that same user: wrong address, another user's address, extra changes (role, status) and any logged-in user are all refused |
| EML-06 | the sole Owner changes their own **role** (any route); a Manager promotes themselves | ✅ refused |
| EML-07 | another Owner changes an Owner's email (O1 route) | ✅ still works at database level (reason + password re-entry: *app level*); a Manager is refused |
| EML-08 | if the profile cannot take the address, the Auth change is rolled back | ✅ both stay as they were. *(The nightly check that compares the two is an app-level task.)* |
| COR-01 | add a correction file to an **Approved** payment with a reason of 10+ characters | ✅ accepted; uploader stamped from the session; audit row; no amount/status/date changes |
| COR-02 | the same without a reason or with a short one; an ordinary file carrying a reason | ✅ refused (`proofs_correction_fields`) |
| COR-03 | add a correction file to a Waiting, Rejected or Reversed payment; add an ordinary file to an Approved one | ✅ refused (`PROOF_CORRECTION_NOT_ALLOWED` / `PROOF_LOCKED`) |
| COR-04 | hide, edit, convert or delete any original or correction file of an Approved payment | ✅ refused (`PROOF_LOCKED`, `DELETE_NOT_ALLOWED`) |
| COR-05 | correction file for an Approved refund | ✅ same rules as payments |
| COR-06 | correction file changes `booking_financials`, the payment row or its history | ✅ never; everything identical before and after |
| COR-07 | correction file appears in the "Corrections added after approval" list and on the booking PDF | ✅ list (`correction_files`: who, when, why, which payment); *PDF: app level* |
| REV-01 | reverse an approved payment while approved refunds depend on it | ✅ refused (`REVERSAL_EXCEEDS_REFUNDS`) — existing test, unchanged |
| REV-02 | the same while a refund is only **waiting** | ✅ refused; allowed once that refund is rejected |
| REV-03 | reverse after the dependent refund was reversed | ✅ allowed |

### 2.13b Real-Supabase verification (only after the owner approves applying the migrations)
These cannot be proven by the in-memory database; see supabase/MIGRATION_REVIEW.md section 12.5.
| ID | Case | Expected |
|---|---|---|
| RSV-01 | `supabase db push --dry-run` against the dev project | lists exactly the 10 migrations, no error |
| RSV-02 | apply to the dev project | all 10 succeed (watch: storage policies, bucket insert, trigger on `auth.users`) |
| RSV-03 | run the same database test suite against a real Supabase Postgres 17 stack in GitHub Actions | all pass |
| RSV-04 | concurrency tests on real Postgres: BID-02/03 (parallel bookings), OWN-06, REF-04, APR-05 | no duplicates, no zero-Owner state, no double refund/approval |
| RSV-05 | privilege queries on the real database | anon: nothing; authenticated: SELECT only; only the 4 allow-listed functions callable |
| RSV-06 | REST probes with the public key | anon cannot read any table or view; a valid login without a profile sees 0 rows |
| RSV-07 | storage probes | buckets private; anon cannot read; well-named upload works; badly named refused; update/delete refused; signed URL expires |
| RSV-08 | real email change with two real mailboxes | both confirm → profile follows; only one confirms → nothing changes; profile refuses → Auth change rolled back |
| RSV-09 | Supabase Advisors (security, performance) | no security errors; every note reviewed |
| RSV-10 | exposed API surface | only the allow-listed functions appear as RPC; no table is writable |
| RSV-11 | time handling around midnight IST | dates and locks switch at IST midnight |

### 2.13c Sign-in and account self-service (implemented 2026-11-11)
| ID | Case | Level | Status |
|---|---|---|---|
| AUTH-U1..U12 | form rules, safe redirects, public pages, error wording (`tests/unit/auth.test.ts`) | unit | passing |
| ACC-01..08 | `complete_password_change`: own flag only, audited, idempotent, refused for no session / disabled / anon, no direct write | PGlite | passing |
| ACC-09, ACC-10 | no function executable by PUBLIC; every function has a fixed search path | PGlite | passing |
| AUTH-S1 | signed-out smoke test of the built app: protected pages redirect, login and forgot-password open, no signup route, security headers | built app, no database | passed once (manual) |
| AUTH-R1..R6 | real sign-in, wrong password, disabled user, reset link, expired link, forced password change | **hosted Supabase** | not run (needs an account) |

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

## 2.16 M2 test inventory (2026-11-11) — what each test ID proves and at which level

| IDs | What | PGlite | Real PG 17 (local) | Hosted |
|---|---|---|---|---|
| AUTH-U1..U12 | sign-in forms, safe redirects, wording | unit | — | — |
| ACC-01..10 | self-service password flag; **no function open to PUBLIC; fixed search path** | ✅ | ✅ | after apply |
| ACM-01..27 | account functions, Owner rules O1–O7, recovery | ✅ | ✅ | after apply |
| MDF-01..11 | master data functions | ✅ | ✅ | after apply |
| BKF-01..42 | bookings, IST nights, plan revisions (D2), cancellation, preview, privileges | ✅ | ✅ | after apply |
| PAF-01..51 | payments, refunds (D1), approvals, reversal protection (D5), proofs, corrections (Q9a), privileges | ✅ | ✅ | after apply |
| FUO-DB-1..3 | first Owner insert rules | ✅ | ✅ | real run needs approval |
| STO-DB1..8 | storage policies (names, read, no replace/delete) | ✅ | ✅ | RSV-07 |
| CON-01..11 | simultaneous requests: booking numbers, double Save, double approval, refund limit, Owner race, reversal vs refund, payment numbers, same-version edits, plan changes, same file | skipped (one connection) | ✅ | after apply |
| ACU-01..12, STO-U1..U10, ERR-01..04, DBC-01..04, FUO-01..06, REC-01..04 | rules and script logic with stand-ins | unit | — | — |

**Mutation checks (schedule, decided 2026-11-11):** the exhaustive 53-mutation suite is deferred to **M9**; M2 runs only essential targeted security/financial checks (`MUTATION_ONLY=...`); M5 repeats targeted financial checks; other milestones run ordinary tests. The runner reports a crashed test process as INCONCLUSIVE (3 tries) and counts it as a problem, never as caught. Earlier: 42 weakened copies of the migrations are all caught by the PGlite tests; five locking weakenings were run against real PostgreSQL 17 (see MIGRATION_REVIEW §13.6).

**How to run**
- Everything quick (PGlite): `npm test`
- Real PostgreSQL 17 (start a throw-away server, then): `STATEADV_PG_URL=postgres://… npm run test:pg17`. The harness refuses any Supabase host.
- Hosted checks: see `supabase/HOSTED_VERIFICATION.md`.

## 2.17 Owner decisions of 2026-11-11 (tests/db/owner-decisions.test.ts and concurrency.pg.test.ts)
| IDs | What | PGlite | Real PG 17 (local) |
|---|---|---|---|
| DEC-1a/b | cancelled booking: payment allowed while a charge is unpaid; above it only a warning; refused when nothing is unpaid | ✅ | ✅ |
| DEC-2a..e | status steps; undo needs 5+ trimmed characters; audit shows action, reason, person, old/new status; a failed undo changes nothing and the reason does not leak into later changes; cancelled/no-show unreachable here | ✅ | ✅ |
| DEC-3a..e | every ordinary reason refuses 0–4 trimmed characters and accepts 5; optional account reasons; 9 refused / 10 accepted for protected Owner actions and correction files | ✅ | ✅ |
| DEC-4 | provider rules for UPI and card, "Other" needs a name, other methods take none | ✅ | ✅ |
| DEC-5a | same numbers (A=700000, D=500000): running limit 200000, cancelled limit 700000 | ✅ | ✅ |
| DEC-5b | waiting refunds use up room, change no balance (D1) on both kinds | ✅ | ✅ |
| DEC-5c..g | approved/rejected/reversed effects; not overpaid = no refund; editing a waiting refund; **direct insert skipping the function is refused**; a booking that becomes cancelled switches limit | ✅ | ✅ |
| CON-12..14 | simultaneous refunds on a running booking; same numbers running vs cancelled; simultaneous edits of two waiting refunds | skipped | ✅ |

Mutation check now has 42 weakened versions (11 added for these decisions).

## 2.18 Configurable C/O, resorts and stay types (tests/db/configurable-master-data.test.ts, migration-17-data.test.ts, concurrency.pg.test.ts, tests/unit/master-data.test.ts)
| IDs | What | PGlite | Real PG 17 (local) |
|---|---|---|---|
| CFG-CO-01..12 | new categories of any name/kind; no fixed number; validation and unique names; names only in list categories, edit, no move; use on bookings; renames never rewrite history; switch-off stops NEW use but old bookings stay readable and editable; mode change; guard and copies cannot be bypassed; Manager and Owner allowed, everyone else refused | pass | pass |
| CFG-RES-01..07 | four placeholders exist and are ordinary; unlimited resorts; edit details, code locked after first booking, logo; Booking IDs never change and numbering continues; switch-off keeps history, payments and edits; rules; authorization | pass | pass |
| CFG-STAY-01..04 | unlimited stay types; rename keeps old bookings; switch-off; authorization | pass | pass |
| MIG17-01..07 | **data-preserving conversion** of a database that already holds bookings, payments, plans and agents | pass | pass |
| CON-15..18 | simultaneous: same category created 10×; renames racing bookings; 30 bookings across 5 resorts (unique, gap-free); resort switched off during bookings | skipped | pass |
| MDS-01..10 | type-to-search rules (switched-off choices, ranking, accents), settings form rules | unit | — |
| STO/ERR/other | error-message coverage includes `STAY_TYPE_INACTIVE` | unit | — |

Mutation check: **53** weakened versions (11 added here). The booking screens that use the picker belong to M4; the picker's rules are tested (MDS-*) and the management screens are built, type-checked and build-tested, but have **not** been exercised in a browser against a real project.

## 2.19 Added during the pre-apply review (2026-11-11)
| IDs | What | PGlite | PG 17 superuser | PG 17 as plain role `postgres` |
|---|---|---|---|---|
| TYP-01..05 | generated TypeScript types match tables, views, enums, functions, columns | pass | pass | pass |
| MIG17-04 (widened) | no constraint or index name in the schema still says "agent" or "partner" | pass | pass | pass |
| whole database suite + 18 simultaneous-request tests | repeated in the "hosted rehearsal" configuration (`STATEADV_PG_RESTRICTED=1`, CI job `database-postgres-17-restricted`) | - | pass | pass |

Totals at the time of writing: PGlite **508** pass / 18 skipped; PostgreSQL 17.11 **355** (+18 concurrency, run separately) in each of the two configurations. CI on GitHub for commit `8be574e` (before these additions): three jobs green (reported by the owner).

## 2.20 Password re-entry enforced by the database (O3, migration 19; local only, 2026-11-11)

| ID | What it proves | PGlite | PG 17.11 | Hosted |
|---|---|---|---|---|
| REA-01 | all five protected Owner actions, called directly, are refused without a grant (`REAUTH_REQUIRED`) and change nothing, not even the audit log | pass | pass | not applied |
| REA-02 | actions that are not protected (names, Managers, adding a Manager) need no grant and behave as before | pass | pass | not applied |
| REA-03 | with a grant the action succeeds, the grant is used, attempt, verification and change are audited in that order | pass | pass | not applied |
| REA-04 | a grant works once (replay refused, not even for the opposite switch) | pass | pass | not applied |
| REA-05 | a grant is valid 60 seconds; an expired one is refused | pass | pass | not applied |
| REA-06 | wrong action, wrong account, another Owner's grant, a grant for a different login: refused; the grants table cannot be read or written by any app role (b) | pass | pass | not applied |
| REA-07 (M1) | a grant is bound to the exact operation (switch on vs off, new role, new email, the login's email): a call with other arguments is refused and does NOT consume the grant; the confirmed call still works once; case and spaces in an email are the same operation | pass | pass | not applied |
| REA-08..10 | only the service role can reserve/issue/record; nobody can claim directly; a Manager or a disabled or unknown actor gets no grant; every operation must be stated exactly; non-Owners still get `OWNER_ACTION_REQUIRES_OWNER` first | pass | pass | not applied |
| REA-11 (M2) | five attempts per 15 minutes reserved BEFORE the password; the sixth refused and adds nothing; a success resets; others unaffected; a wrong password is audited with no password data and is not an extra attempt | pass | pass | not applied |
| REA-12 | a refused protected call does not use up the grant; self-disable, own role change, own password reset still refused with a grant | pass | pass | not applied |
| REA-13 (L2) | `issue_reauth` returns void; the grant id appears in no audit row | pass | pass | not applied |
| REA-14 (L3) | reauth audit rows are visible to Owners only (also in a person's history), all rows stay in the table, Managers still see all other audit rows, a switched-off Owner sees none | pass | pass | not applied |
| REA-15 | for every action and role the SQL asks for a grant exactly when `isProtectedAction` asks for the password, and the mapped grant name and operation are the ones the database accepts | pass | pass | not applied |
| REA-16a..g (M2) | the 15-minute attempt window with controlled timestamps (rows inserted with a chosen `occurred_at`, then the real `reauth_begin` called): five attempts inside lock, four do not; attempts older than 15 minutes (up to a week) never count; mixed inside and outside; the boundary (14m55s inside, 15m05s aged out, exactly 15m00s already outside); a success resets (older attempts stop counting, later ones count again); independent counters per Owner; failure rows and success rows without reserved attempts never lock | pass | pass | not applied |
| CON-19 | six simultaneous calls on one grant (three for the confirmed email, three for others): exactly one success, from the confirmed ones; the grant is used once; two Owners switching each other off with grants never leave zero Owners | skipped (needs real connections) | pass | not applied |
| CON-20 (M2) | twenty simultaneous attempts reserve exactly five (two rounds, a success in between); another Owner is not blocked | skipped | pass | not applied |
| REAUTH-U1..U13 (unit) | order of steps (reserve, verify, issue), the password reaches only Supabase Auth, a lock stops the attempt before the password, every database error stops the flow (fail closed), the undo reuses one verification, the operation is canonical and never missing, mapping equals `isProtectedAction` | pass | - | - |
| PRE-U1..U8, PRE-DB-1 | hosted-preflight logic with no hard-coded range: pending = what follows the hosted history, tampered or unknown history reported, destructive statements need declared preconditions, function/table/policy extraction, baseline = last applied definition, and the text read from the migration files equals `pg_proc.prosrc` for every function | pass | pass | - |
| 24 mutation checks "O3: ..." | removing any consume call, the user/target/operation binding, expiry, single use, service-role-only issuing or reserving, the five-attempt limit, the reset, the Owner-only rule, the table lock, the three-valued-logic guard, or the audit visibility policy is noticed | 23/23 caught (the 5 window mutations: window far too long, far too short, boundary `>=`, failures counted instead of attempts, counter shared between Owners) | 1/1 caught (advisory lock) | - |

Existing tests that call protected actions directly (ACM-03/10/13/15/21/24, DEC-3e, CON-04) now issue a grant first (`reauth()` in tests/db/fixtures.ts, with the common operation as default). One real defect was found by these tests while writing them: a NULL operation slipped through a SQL three-valued-logic test in `issue_reauth`; fixed with an explicit coalesce and an equivalent guard on the table constraint. Not testable until a second Owner exists: the real Supabase Auth password check and the screens.
