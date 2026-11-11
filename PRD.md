# PRD — Multi-Resort Management and Financial Tracking System

| Item | Value |
|---|---|
| Document | Product Requirements Document |
| Milestone | M0 – Requirement Analysis and Architecture |
| Status | **M0 approved (2026-11-11). Q11 hosting budget deferred. Second Owner account pending: details not yet provided (§12.1).** |
| Last updated | 2026-11-11 |

---

## 1. Purpose

The owner runs four resorts (the number will grow). Today most booking and payment records are kept by hand. The owner needs **one internal web application** that answers, for each resort and in total:

- How many bookings were received.
- How much money is expected, and when.
- How much money has been received and approved.
- Which payments and refunds are waiting for approval.
- How much money is still pending.
- Whether the payments managers entered match the uploaded payment screenshots or receipts.
- Who created or changed each record, and when.

## 2. What this product is NOT

These are **out of scope** unless the owner asks for them:

- Public booking website, online reservations or a booking marketplace.
- Payment gateway or online payment collection.
- Restaurant POS or billing.
- GST invoices or tax filing.
- **Room/cottage allocation** (decided Q15).
- Agent commission calculation and settlement.
- SMS, WhatsApp or email notifications to guests.
- Percentage discounts (decided Q14: rupee discounts only in version 1).

## 3. Users

| User | Description | Access |
|---|---|---|
| Owner | Business owner | Full access |
| Manager | Resort staff | **Same** full access as the owner, including user management (decided Q10). Owner accounts have extra protection (FR-AUTH-9 to 13). |

Rules:
- Every person has their **own login (email + password)**. Shared logins are not allowed. The app shows the person's name everywhere, not their email.
- The owner and managers use the **same screens**. There are no separate dashboards.
- Managers are **not** limited to one resort.
- The role (Owner / Manager) gives **no difference in operational permissions** (bookings, payments, refunds, approvals, reports, resorts, settings).
- Any active user can add users, edit user details, disable/enable users and reset passwords. **A user cannot disable their own account.** Every account action is recorded in the audit history.
- **Owner-account protection** (§5.1, FR-AUTH-9 to FR-AUTH-13) is the only place where the role matters. It protects owner accounts and makes sure **at least one active Owner account always exists**.

Users are assumed to be non-technical, often on mobile phones, sometimes on slow connections.

## 4. Glossary (simple words used in the app)

| Term in app | Meaning |
|---|---|
| Booking ID | Automatic number per resort and year, e.g. `RSA-2026-000001` |
| PAX | Number of people in the booking |
| Pricing Method | **Per person per night** or **Per person per stay** |
| C/O | Who brought the booking: Agent, Partner, Own or Direct |
| Extra Charges | Optional additional amount (e.g. extra bed, food) |
| Final Booking Amount | Total Amount − Discount (± Manual Adjustment, with reason) |
| Payment Plan | When the guest is expected to pay, and how much on each date |
| Payment | One entry of money received. A booking can have many payments. |
| Refund | Money given back to the guest. It is a separate record, never a negative payment. |
| Payment Screenshot / Receipt | Proof file uploaded for a payment or refund |
| Waiting for Approval | Recorded, not yet checked |
| Approved | Checked and accepted |
| Rejected | Checked and found wrong. It does not count. |
| Reversed | Approved earlier, later cancelled. It does not count. |
| Self-approved | Approved by the same person who recorded it |
| Total Collection (Approved) | Sum of approved payments only |
| Net Collection | Approved Payments − Approved Refunds |
| Pending Amount | Money not yet recorded against what is due |
| Verified Remaining | Money not yet approved against what is due |
| Extra Payment | Money recorded above what is due (overpaid). Can be refunded. |
| Cancellation Charge | Amount the resort keeps when a booking is cancelled or is a no-show |
| Amount Due | What the guest should finally pay: the Final Booking Amount, or the Cancellation Charge after cancellation/no-show |
| Expected Collection | Money due in a period, from payment plans plus Expected Adjustments |
| Expected Adjustment | A dated correction to expected money (e.g. after a cancellation), recorded with a reason. It never changes past figures. |
| Past due row | A payment-plan row whose due date is before today. It is locked. |
| Old Records | Searching and viewing past records |

## 5. Functional requirements

### 5.1 Authentication and user management (decided Q10)
- FR-AUTH-1 Log in with **email and password**. Public sign-up is not allowed.
- FR-AUTH-2 Log out. Sessions expire automatically.
- FR-AUTH-3 Any active user can **add a user** (full name, email, role label, temporary password), **edit** name/role label, **disable** or **re-enable** a user, and **reset a password** (set a new temporary password). Actions on **Owner** accounts follow FR-AUTH-9 to FR-AUTH-13.
- FR-AUTH-4 A user **cannot disable their own account**. This is blocked in the app and in the database.
- FR-AUTH-5 New users and users with a reset password must change their password at their next login.
- FR-AUTH-6 A disabled user can no longer log in or perform actions. All their past records stay, and their name still shows on those records.
- FR-AUTH-7 Every account action (user added, details changed, disabled, enabled, password reset) is recorded in the audit history with who did it, to whom, and when. Passwords are never logged.
- FR-AUTH-8 Every business action records the logged-in user.

**Owner-account protection** (decided; rules O1–O4 in §12.2, one-Owner clarification O5–O6)
- FR-AUTH-9 **At least one active Owner account must always exist.** The system blocks any action that would leave zero active Owners: disabling the last active Owner, or changing the last active Owner's role to Manager.
- FR-AUTH-10 **Protected actions on an Owner account** can be done only by **another active Owner**: disabling it, resetting its password, changing its email, or changing its role. Managers can still view Owner accounts. *(O1)*
- FR-AUTH-11 **Only an Owner can give the Owner role** to a user (create an Owner, or promote a Manager to Owner). A Manager cannot make themselves or anyone else an Owner. *(O2)*
- FR-AUTH-12 A protected action needs (a) a written **reason** and (b) the acting Owner to **re-enter their own password**. It is recorded in the audit history, and the dashboard shows an alert to all users ("Owner account Ravi Kumar was disabled by Sunita Rao – reason …"). *(O3)*
- FR-AUTH-13 **Account recovery**, in this order:
  1. The Owner who forgot their password uses the "Forgot password" email link (Owner accounts only). If a second Owner exists, that Owner can also reset the account.
  2. If no Owner can log in, the recovery procedure (DEPLOYMENT_GUIDE §7.4) uses a one-time server script, run by the business owner on their own computer with the Supabase project credentials, to re-enable the Owner account, set a temporary password and, if needed, remove a lost two-step login (MFA) device. The script writes an audit entry "owner_recovered" with its reason.
  3. Recommended: keep **two Owner accounts** and turn on two-step login (MFA) for Owner accounts. *(O4)* The second Owner is **optional and pending** (FR-AUTH-14).
- FR-AUTH-14 **The system works securely with exactly one active Owner** *(O5, decided 2026-11-11)*:
  1. At the start there is **one real Owner account**: the business owner's. **No second, placeholder, dummy or test Owner is created in the real data, and no fake email address is ever used.**
  2. All rules above still apply: at least one active Owner always exists; the sole Owner cannot disable or demote themselves, and no one else can disable, demote, reset or re-email the sole Owner's account (managers are blocked by O1/O2).
  3. While there is only one active Owner, the Users page and the dashboard show a visible notice to Owners ("Only one Owner account exists. Add a second Owner so access can be recovered"), and the recovery limitations in SECURITY.md §3.2a apply.
- FR-AUTH-15 **Adding the second Owner later** *(O6, decided 2026-11-11)*: only the existing Owner can do it, in the app, through Settings → Users → Add User with the role **Owner** (FR-AUTH-11). It creates a real account with a temporary password that the new Owner must change at first login. It needs a written reason and the acting Owner's password re-entered, and is audited and shown as a dashboard alert. Sending an email invitation link is not part of version 1 (it needs the production email sender, Q11). The second Owner can be added at any time, with no development work.

### 5.2 Resort management
- FR-RES-1 Add, edit and view a resort.
- FR-RES-2 Fields: Resort Code (unique, 2–10 uppercase letters/digits), Resort Name, Location, Contact Number, Logo.
- FR-RES-3 The Resort Code is used in Booking IDs, so it **cannot be changed once the resort has any booking**.
- FR-RES-4 Activate or deactivate a resort. New bookings cannot be created for an inactive resort. All old records stay visible and searchable.
- FR-RES-5 No resort is hard-coded anywhere. A new resort gets every feature automatically, because all data is linked by `resort_id`.
- FR-RES-6 Resorts are never deleted.

### 5.3 Guest management
- FR-GST-1 Store Guest Name, Mobile Number, and optional details (email, city/address, notes).
- FR-GST-2 A guest can have many bookings. The guest page shows their booking history.
- FR-GST-3 Search by name (partial) and mobile number (partial, ignoring spaces and +91).
- FR-GST-4 While entering a booking, the app suggests existing guests with the same mobile number. Mobile numbers are **not** forced to be unique (families share phones).
- FR-GST-5 Each booking keeps a copy of the guest name and mobile at booking time. Later edits to the guest record do not rewrite old bookings.

### 5.4 Agents and partners
- FR-AP-1 A reusable list of Agent names and Partner names, with optional mobile and notes.
- FR-AP-2 Add, edit and deactivate entries. Deactivated names stay on old bookings.
- FR-AP-3 In the booking form the user picks from the list, or adds a new name quickly.

### 5.5 Booking management
- FR-BK-1 Booking fields: Resort, Guest Name, Mobile, PAX, C/O Category, C/O Name, Stay Type, Booking Date, Check-in date and time, Check-out date and time, Pricing Method, Tariff Per Person, Number of Nights, Extra Charges, Total Amount, Discount, Final Booking Amount, Manual Adjustment Reason, Remarks.
- FR-BK-2 **C/O** (decided Q3), exactly four categories:

| Category | Name rule |
|---|---|
| Agent | Agent name **required**, chosen from the Agents list |
| Partner | Partner name **required**, chosen from the Partners list |
| Own | Person/source name **required** (free text, with suggestions from earlier entries) |
| Direct | No name |

- FR-BK-3 **Stay Type** comes from an editable list, starting with **Resort Stay, Day Outing, Package** (decided Q2). New types can be added and old ones deactivated in Settings.
- FR-BK-4 **Amount calculation** (decided Q1):
  1. The user selects the **Pricing Method**:
     - **Per person per night:** Base Amount = PAX × Tariff × Number of Nights.
     - **Per person per stay:** Base Amount = PAX × Tariff.
  2. **Number of Nights** = check-out date − check-in date, counted in calendar days (IST). It is shown automatically, and it must be at least 1 for the per-night method. *(Decided D4.)*
  3. **Total Amount** = Base Amount + Extra Charges (optional, ₹0 default, with a short description).
  4. **Discount**: a rupee amount only (Q14), from ₹0 up to the Total Amount.
  5. **Calculated Final Amount** = Total Amount − Discount.
  6. **Manual adjustment:** the user may change the Final Booking Amount to a different value **only with a mandatory reason**. The app stores the difference as "Manual Adjustment" (+ or −), keeps the calculated value, and records the change in the audit history. The Final Booking Amount can never be below ₹0.
  7. **Final Booking Amount** = Total Amount − Discount + Manual Adjustment.

  Example: Per stay, 2 × ₹2,500 = ₹5,000, extra ₹0, discount ₹0, so Final = ₹5,000.
  Example: Per night, 2 × ₹2,500 × 2 nights = ₹10,000, extra ₹500, discount ₹1,000, so Final = ₹9,500.

- FR-BK-5 The server always recalculates every amount and never trusts amounts sent by the browser.
- FR-BK-6 Check-out must be after check-in. PAX must be at least 1.
- FR-BK-7 **Editing a booking** (decided Q13, Q16):
  - Any field can be edited with an audit history entry, **except** the Resort and the year of the Booking Date (see FR-BID-4).
  - Changing anything that affects the amount (pricing method, PAX, tariff, dates/nights, extra charges, discount, manual adjustment) requires a **mandatory reason** and an **updated payment plan** following the FR-SCH-5 rules (past due rows stay locked; the difference is planned on new dates or recorded as an Expected Adjustment). Both are saved together, and a **new PDF version** is created.
  - Existing payments and refunds (approved or not) are **never changed or deleted**. If the new amount is lower than the money already approved, the booking shows Extra Payment / Refund due.
  - If the check-in date changes, the app reminds the user to check the payment plan due dates. It does not change them automatically.
- FR-BK-8 **Cancel booking / Mark No-show** (decided Q7, Q7a, Q7c): see §5.10.
- FR-BK-9 Booking status: Confirmed, Checked-in, Checked-out, Cancelled, No-show. Cancelled and No-show are final.
- FR-BK-10 Booking list with search by Booking ID, guest name, mobile and C/O name, plus filters for resort, status, date type and range.
- FR-BK-11 Pressing Save twice never creates two bookings.
- FR-BK-12 If two users edit the same booking at the same time, the second save is refused with a clear message ("Someone else changed this booking. Please reload.").

### 5.6 Booking ID (decided Q4, Q16)
- FR-BID-1 Format `{RESORT_CODE}-{YYYY}-{NNNNNN}`, e.g. `RSA-2026-000001`, `RSA-2026-000002`, `DRI-2026-000001`.
- FR-BID-2 Each resort has its **own counter, restarting at 000001 every year**. **YYYY is the year of the Booking Date.** A booking entered in January 2027 with a booking date in December 2026 gets the next 2026 number for that resort.
- FR-BID-3 Generated by the database in the same transaction as the booking. Unique, safe when many users save at the same moment, and never reused (including after cancellation).
- FR-BID-4 After a Booking ID is issued, the **Resort** and the **year of the Booking Date cannot be changed**. To correct such a mistake, cancel the booking (with a reason and a ₹0 cancellation charge where nothing is to be kept) and create a new booking. Changes to the Booking Date within the same year are allowed and recorded in the audit history.
- FR-BID-5 Shown on every payment, refund, PDF and report, and searchable.

### 5.7 Payment plan (decided Q6, Q6b)
- FR-SCH-1 Every booking has a payment plan: one or more rows of *label + due date + amount*.
- FR-SCH-2 The form starts with two rows: **Advance** (due date = Booking Date) and **Balance** (due date = Check-in date). **Amounts start empty. The app never suggests an advance percentage, a fixed advance, or the balance amount.** The user types both amounts and can change any due date, add rows or remove rows.
- FR-SCH-3 The form shows live "Plan total ₹X of ₹Y". The booking cannot be saved until the plan total **equals the Amount Due** (the Final Booking Amount, or the Cancellation Charge after cancellation).
- FR-SCH-4 **Past due rows are locked** (decided D2). A plan row whose due date is before today (IST) is "past due". It can never be edited, replaced or removed, and its amount stays in historical Expected Collection for its due date.
- FR-SCH-5 **Changing a plan later** (plan edit, booking amount change, cancellation, no-show, charge correction) works like this:
  1. Past due rows stay as they are.
  2. Rows due today or later are replaced by the new rows the user enters (also due today or later). The old ones are kept as history marked "Replaced", and are never deleted.
  3. The system works out **Amount still to plan** = Amount Due − (past due rows + earlier adjustments).
     - If it is positive, the user's new rows must add up to exactly that amount.
     - If it is **negative** (the past due rows now expect more than the new Amount Due, e.g. after a cancellation), the system records an **Expected Adjustment** for the difference, dated today with the user's reason. No new rows are needed.
  4. **Move an unpaid past amount to a new date:** the user may choose to move some or all of an overdue amount. This records a negative Expected Adjustment today (with reason), and the user adds new rows for the same amount on later dates.
- FR-SCH-6 An **Expected Adjustment** is a separate, permanent record: booking, date, amount (+ or −), reason, source (cancellation / no-show / amount change / plan change / charge change / move overdue), who, when. It can never be edited or deleted.
- FR-SCH-7 **Rule that always holds:** active plan rows + Expected Adjustments = Amount Due. Each rupee is expected exactly once overall, historical figures never change, and corrections show up on the date they were made.
- FR-SCH-8 A booking's first plan (at creation) may include rows with past due dates (for example a late entry of a booking whose advance was due last week). These count from the moment the booking is saved.

### 5.8 Payments
- FR-PAY-1 Add Payment to a booking: Amount, Method (Cash, UPI, Card, Cheque, Other), Provider/Subtype (UPI: PhonePe, Google Pay, Paytm, BHIM, Other), Actual Payment Date, Actual Payment Time (optional), Reference Number, Remarks, Payment Screenshot/Receipt files.
- FR-PAY-2 **Proof** (decided Q9): **mandatory** (at least one file) for **UPI, Card and Cheque**. **Optional** for **Cash and Other**.
- FR-PAY-3 Files: JPG, PNG, WEBP, PDF (HEIC converted in the browser), up to 10 MB each, up to 5 per payment. They are stored privately.
- FR-PAY-4 Recorded By and the entry date/time are stored automatically. Backdated payment dates are allowed. Future payment dates are not allowed.
- FR-PAY-5 New payments always start as **Waiting for Approval**.
- FR-PAY-6 Warnings (they do not block saving):
  - The same reference number is already used on another payment.
  - The same screenshot file is already attached to another payment.
  - The payment takes the booking above its Amount Due.
- FR-PAY-7 A payment that is Waiting for Approval can be edited (reason + audit history). An extra proof can be added, or a wrong file hidden (never deleted), but the last proof of a UPI/Card/Cheque payment cannot be hidden.
- FR-PAY-8 Approved, Rejected and Reversed payments cannot be edited. Corrections are made by Reject/Reverse and a new entry.
- FR-PAY-9 Payments are never deleted.
- FR-PAY-10 Pressing Save twice never creates two payments.
- FR-PAY-11 Payments cannot be added to Cancelled/No-show bookings, except to collect an unpaid cancellation charge (only up to the Pending Amount; above that, a warning).

### 5.9 Payment approval
- FR-APR-1 The "Waiting for Approval" screen lists waiting payments (tab 1) and waiting refunds (tab 2), with resort and date filters, oldest first.
- FR-APR-2 The reviewer sees the details next to a large screenshot viewer, plus the booking money summary and approval history.
- FR-APR-3 Allowed changes:
  - Waiting → **Approved**
  - Waiting → **Rejected** (reason required)
  - Approved → **Reversed** (reason required)
  - Rejected and Reversed are final.
- FR-APR-4 Every change adds an approval history row (who, when, from, to, reason). History is never overwritten or deleted.
- FR-APR-5 **Self-approval is allowed** (decided Q8). It is shown as **"Self-approved"** on screen, in approval history, audit history, PDF and reports, with a filter and a dashboard count.
- FR-APR-6 If two users act on the same item at the same moment, only the first succeeds. The second sees "This payment was already approved by <name>".

### 5.10 Cancellation, No-show and Refunds (decided Q7, Q7a, Q7b, Q7c, Q12)

**Cancel booking**
- FR-CAN-1 The user must enter a **reason**, the **cancellation date** (default today, IST), and the **Cancellation Charge**. There is **no default charge**; the field starts empty and must be typed (₹0 is allowed).
- FR-CAN-2 The charge must be between ₹0 and the Final Booking Amount.

**Mark No-show**
- FR-CAN-3 Requires a reason and a date. The Cancellation Charge is **pre-filled with the full Final Booking Amount**. If the user changes it, a separate **"reason for changing the charge"** is required.

**Both**
- FR-CAN-4 The original booking amounts (Total, Discount, Final) are **never overwritten**. They stay visible as **"Original Booking Amount"**.
- FR-CAN-5 From then on, the **Amount Due = Cancellation Charge**. Pending, Verified Remaining, Extra Payment, Expected Collection and PDFs use the Cancellation Charge, **not** the original amount.
- FR-CAN-6 The payment plan is updated using the FR-SCH-5 rules:
  - Past due rows stay, and so does their historical expected amount.
  - Rows due today or later are replaced by a **cancellation plan** for the Amount still to plan (default: one row due today, editable to a later date).
  - If the past due rows add up to more than the Cancellation Charge, an Expected Adjustment (negative, dated today, reason = the cancellation reason) is recorded automatically.

  The cancellation date cannot be in the future.
- FR-CAN-7 Existing payments and refunds stay unchanged. If approved money is more than the charge, the booking shows **"Refund due ₹X"**.
- FR-CAN-8 Cancelled and No-show bookings cannot return to an active status. The Cancellation Charge can be corrected later only with a reason. This creates a new cancellation plan, an audit entry and a new PDF version.
- FR-CAN-9 Cancellation creates an audit entry and a new PDF version.

**Refunds**
- FR-REF-1 Refunds are **separate financial records** (never negative payments, never edits to payments). Fields: Amount, Method, Provider, Actual Refund Date, Time (optional), Reference Number, Reason, Remarks, Proof files, Recorded By, Status, approval fields.
- FR-REF-2 Refunds can be recorded for **cancelled/no-show bookings** and for **overpaid active bookings** (decided Q12).
- FR-REF-3 A refund amount cannot be more than the approved money still held for the booking: Approved Payments − Approved Refunds − Refunds Waiting for Approval. If it is more than the "Refund due" amount, a warning is shown.
- FR-REF-4 Refunds have **their own approval process** (decided Q7b) with the same statuses, rules, approval history and Self-approved indicator as payments (§5.9).
- FR-REF-5 Proof rule: the same as payments (mandatory for UPI/Card/Cheque, optional for Cash/Other). *(Decided D3.)*
- FR-REF-6 Refunds are never deleted. Mistakes are corrected by Reject/Reverse plus a new entry.
- FR-REF-7 Refunds appear on the booking page, in the PDF, in the audit history and as a separate line in reports.

### 5.11 Financial values (single set of rules, used everywhere)

Definitions per booking (A = approved payments, W = waiting payments, RA = approved refunds, RW = waiting refunds):

| # | Value | Formula |
|---|---|---|
| 1 | Original / Final Booking Amount (F) | Total − Discount + Manual Adjustment. Never overwritten. |
| 2 | **Amount Due (D)** | F for active bookings. The **Cancellation Charge** for Cancelled/No-show. |
| 3 | Total Recorded Payments | A + W (rejected and reversed excluded) |
| 4 | **Total Collection (Approved)** | **A** (approved payments only) |
| 5 | Waiting for Approval | W, always shown separately and never counted as collection |
| 6 | Rejected Payments / Reversed Payments | shown for information only, never counted |
| 7 | Refunds (Approved) | RA |
| 8 | Refunds Waiting for Approval | RW |
| 9 | **Net Collection** | **A − RA** |
| 10 | **Pending Amount** | max(D − (A + W − RA), 0) |
| 11 | **Verified Remaining** | max(D − (A − RA), 0) |
| 12 | **Extra Payment** | max((A + W − RA) − D, 0) |
| 13 | **Refund due** | max((A − RA) − D, 0) |
| 14 | **Refund still to record** | max(Refund due − RW, 0) |
| 15 | Most that can be refunded now | A − RA − RW |

**Waiting refunds (RW) never change Pending, Verified Remaining, Extra Payment, Refund due, Total Collection or Net Collection** (decided D1). They appear only in their own line ("Refunds Waiting for Approval") and in "Refund still to record". RW also lowers the most that can be refunded now, so the same money cannot be refunded twice.

Notes:
- For a booking with no refunds and no cancellation, these reduce exactly to the owner's rules: Pending = F − (A + W), Verified Remaining = F − A.
- Pending and Verified Remaining are never negative. Overpayment shows only as Extra Payment / Refund due.
- Waiting payments are **never** counted in Total Collection or Net Collection anywhere.

**Worked examples (D1)**

*Example A: cancellation with refund.* Final ₹5,000, approved payments ₹3,000, cancelled with charge ₹1,000 (D = ₹1,000).

| Stage | A | W | RA | RW | Pending | Verified Rem. | Extra | Refund due | Refund still to record | Total Coll. | Net Coll. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| After cancellation | 3,000 | 0 | 0 | 0 | 0 | 0 | 2,000 | 2,000 | 2,000 | 3,000 | 3,000 |
| Refund ₹2,000 recorded (waiting) | 3,000 | 0 | 0 | 2,000 | 0 | 0 | 2,000 | 2,000 | **0** | 3,000 | **3,000** |
| Refund approved | 3,000 | 0 | 2,000 | 0 | 0 | 0 | 0 | 0 | 0 | 3,000 | **1,000** |
| *Or:* refund rejected | 3,000 | 0 | 0 | 0 | 0 | 0 | 2,000 | 2,000 | 2,000 | 3,000 | 3,000 |

*Example B: where Pending is affected.* Final ₹5,000 (active booking). The guest paid ₹6,000 (approved). The resort records a refund of ₹1,500 (more than the ₹1,000 extra, allowed with a warning).

| Stage | A | RA | RW | Pending | Verified Rem. | Extra | Refund due | Net Coll. |
|---|---|---|---|---|---|---|---|---|
| Before refund | 6,000 | 0 | 0 | 0 | 0 | 1,000 | 1,000 | 6,000 |
| Refund ₹1,500 waiting | 6,000 | 0 | 1,500 | **0** (waiting refund ignored) | 0 | 1,000 | 1,000 | 6,000 |
| Refund ₹1,500 approved | 6,000 | 1,500 | 0 | **500** | 500 | 0 | 0 | 4,500 |

Pending changes only when the refund is approved.
- All money is stored as whole **paise** (integers). No floating-point arithmetic.
- The database calculates these values once. Screens, PDFs and reports all read the same calculation.

### 5.12 Expected vs actual collection (period figures)
| Value | Rule | Date used |
|---|---|---|
| Originally Expected | Sum of **active** payment-plan rows due in the period. Past due rows are never removed. | Plan due date |
| Expected Adjustments | Sum of Expected Adjustments dated in the period (usually negative: cancellations, reductions, moved amounts) | Adjustment date |
| **Expected Collection** | Originally Expected + Expected Adjustments | — |
| Total Collection (Approved) | Sum of approved payments | Actual payment date |
| Waiting for Approval | Sum of waiting payments (shown separately) | Actual payment date |
| Refunds (Approved) | Sum of approved refunds | **Actual refund date** |
| Net Collection | Total Collection (Approved) − Refunds (Approved) | as above |
| Difference | Expected Collection − Total Collection (Approved). Net Collection is shown next to it. | |
| Overdue (as of a date X) | max(all expected up to X (rows due ≤ X + adjustments dated ≤ X) − Net Collection approved with payment/refund date ≤ X, 0), per booking | Due/adjustment date |

**Historical expected figures never change** (decided D2): past due rows are locked, and later changes appear as dated adjustments. Every rupee is counted once over time (FR-SCH-7).

*Example C (D2).* Final ₹5,000. Plan: Advance ₹2,000 due 1 Oct, Balance ₹3,000 due 1 Dec. Cancelled on 10 Nov with charge ₹1,000.
- 1 Oct is past, so the ₹2,000 row is locked. The 1 Dec row is replaced (not past yet).
- Amount still to plan = 1,000 − 2,000 = −1,000, so an **Expected Adjustment of −₹1,000 is dated 10 Nov**, reason "Booking cancelled: guest illness".
- Reports: October Expected **₹2,000 (unchanged)** · November Expected **−₹1,000** (adjustment) · December Expected **₹0**. The total over all months is ₹1,000 = the Cancellation Charge.

*Example D (D2).* The same booking, but cancelled on 10 Nov with charge ₹3,000. Amount still to plan = 3,000 − 2,000 = +1,000 → a new cancellation row ₹1,000 due 10 Nov (or a later date chosen). October ₹2,000 (unchanged), November ₹1,000, December ₹0. Total ₹3,000.

*Example E (D2, moving an overdue amount).* The advance of ₹2,000 (due 1 Oct) was never paid. On 10 Nov the user moves it to 15 Dec. October stays ₹2,000, November gets an adjustment of −₹2,000 (reason "Guest will pay at check-in"), December gets +₹2,000. The overdue amount drops to ₹0 from 10 Nov.

### 5.13 Calendar and old records
- FR-CAL-1 A month calendar showing check-ins, check-outs and in-house stays per day, with a resort filter. Any past or future date can be opened.
- FR-CAL-2 Clicking a day lists that day's check-ins, check-outs, in-house stays, payments received, refunds and payments due, with quick actions.
- FR-CAL-3 Separately stored dates: Booking Date, Check-in, Check-out, Actual Payment Date, Actual Refund Date, Cancellation Date, Entry date/time, Last Updated date/time.
- FR-CAL-4 There is no time limit on old records. Everything stays searchable: bookings, payments, refunds, screenshots, approval history and PDF versions.
- FR-CAL-5 An "Old Records" search page.

### 5.14 Automatic booking PDF
- FR-PDF-1 A new PDF version is generated automatically after: the booking is created; any booking edit; a payment plan change; a payment or refund being added, edited, approved, rejected or reversed; cancellation, no-show, or a change to the cancellation charge.
- FR-PDF-2 Contents:
  - Resort name and logo, Booking ID, status.
  - Guest information, mobile, PAX, C/O, stay type, check-in/out, nights.
  - Pricing method, tariff, extra charges, total, discount, manual adjustment (with reason), Final Booking Amount.
  - For cancelled/no-show bookings: cancellation details and charge (Amount Due), with the original amount shown separately.
  - The payment plan (active rows, including locked past due rows) and any Expected Adjustments.
  - A payment table: amount, method, date, status, self-approved mark.
  - A refund table.
  - Totals: Total Collection (Approved), Waiting for Approval, Refunds, Net Collection, Pending Amount, Extra Payment / Refund due.
  - PDF generation date/time and version number.
- FR-PDF-3 Footer: *"Internal booking and payment statement. This is not a tax invoice. Amounts marked 'Waiting for Approval' are not yet verified."*
- FR-PDF-4 Every version is kept (v1, v2, …). The current and old versions can be downloaded at any time.
- FR-PDF-5 If nothing printed in the PDF has changed, no new version is created.
- FR-PDF-6 If PDF generation fails, the booking/payment is **still saved**. The PDF is retried automatically, and the user can press "Regenerate PDF".

### 5.15 Dashboard (decided Q17)
- FR-DSH-1 One dashboard for all users.
- FR-DSH-2 Cards: Total Resorts (active) · Total Bookings · Today's Check-ins · Today's Check-outs · Expected Collection · **Total Collection (Approved)** (one combined card; there is no separate "Paid and Approved" card) · **Waiting for Approval** (separate card) · Pending Amount. The Total Collection card has a small line underneath: "Refunds ₹X · Net Collection ₹Y".
- FR-DSH-3 Filters: resort (all or one) and date range (Today, This Week, This Month, This Year, Custom). Each card states which date it uses.
- FR-DSH-4 Resort-wise summary table, date-wise collection chart, recent bookings, recent payments, recent activity, and alerts (old waiting items, overdue plans, self-approved count, PDF failures, backup age).

### 5.16 Reports
Each report has filters for resort, date range and status, and can be exported to CSV and PDF.

| Report | Date used | Main numbers |
|---|---|---|
| Daily / Weekly / Monthly / Yearly Collection | Payment date; refund date | Total Collection (Approved), Waiting, Refunds, Net Collection, by resort/method |
| Resort-wise Collection | Due date, adjustment date, payment/refund date | Originally Expected, Expected Adjustments, Expected, Total Collection (Approved), Waiting, Refunds, Net, Difference |
| Payment Method Report | Payment date; refund date | By method/provider: approved, waiting, refunds |
| Booking Report | Booking date or check-in (user chooses) | Count, PAX, pricing method, Final Amount, Amount Due, C/O, status |
| Pending Amount Report | As of a date | Bookings with Pending > 0 or Verified Remaining > 0, overdue |
| Waiting for Approval Report | Entry date or payment/refund date | Waiting payments and refunds, age in days |
| Refund Report | Actual refund date | Refunds by status, resort, method, reason |
| Cancellation Report | Cancellation date | Cancelled/no-show bookings, original amount, charge, refund due |
| Expected Adjustments Report | Adjustment date | Every adjustment with booking, amount, source, reason, user |

Every report header states the date used, the approval rule applied, and the time zone (IST).

### 5.17 Audit history
- FR-AUD-1 Logged: every create, update, status change, upload, hide-file, approval, rejection, reversal, cancellation, no-show, refund, plan change, manual adjustment, and every user-account action. Each entry has who, what, which record, when, old and new values, and the reason.
- FR-AUD-2 The audit log can only be added to. Nobody can edit or delete it.
- FR-AUD-3 An Activity screen with filters (user, record type, resort, date). Booking and payment pages show their own history.

## 6. Non-functional requirements
| Area | Requirement |
|---|---|
| Correctness | Integer paise. Totals calculated in the database. Every calculation has automated tests. |
| Reliability | Multi-step financial actions run in one transaction. Duplicate submissions are blocked. |
| Security | Login required. Row Level Security. Private files with short-lived links. No secret keys in the browser. |
| Data safety | No hard deletion of business/financial records. Daily backups of the database **and** the files. Restore tested quarterly. |
| Usability | Simple English, large touch targets, works on a budget Android phone, clear errors. |
| Performance | Common pages within 2 s on 4G up to about 100k bookings / 300k payments. |
| Time zone | All business dates in **Asia/Kolkata (IST)**. |
| Currency | INR only, shown in Indian format (₹1,50,000). |
| Browsers | Latest Chrome, Edge, Safari and Firefox, plus Android Chrome and iOS Safari. |
| Language | English only. |

## 7. Assumptions (minor details)
1. One currency (INR), one time zone (IST).
2. Up to about 25 users and 20 resorts in the first years.
3. Guests do not log in.
4. Every payment and refund belongs to a booking.
5. An internet connection is available (no offline mode).
6. Users' email addresses are used only for login. Password resets are done by another user setting a temporary password, so the app does not depend on sending emails.

## 8. Success criteria
- Every rupee on the dashboard can be traced to individual payments/refunds and their screenshots.
- Expected vs actual numbers match a hand-calculated check on test data.
- No record can be lost or changed without an audit history entry.

## 9. Risks (summary; details in TRD §6, DATABASE_SCHEMA §8, SECURITY §10)
| # | Risk | Solution |
|---|---|---|
| R1 | Floating-point money errors | Integer paise; calculations in the database |
| R2 | Duplicate Booking IDs under concurrency | Row-locked counter per resort per year, in the same transaction |
| R3 | Double-click creates duplicates | Idempotency key + unique constraint |
| R4 | Expected Collection counted twice | Replaced plan rows never count. Plan total = Amount Due is enforced. |
| R5 | Advance payments make "Difference" misleading | Overdue view (oldest-due-first) shown alongside |
| R6 | Self-approval fraud | Allowed but flagged everywhere, with a filter and a dashboard count |
| R7 | Same screenshot reused | File hash comparison, with a warning |
| R8 | DB backups exclude files | Separate daily file backup |
| R9 | Free hosting plans: no backups / pausing / non-commercial terms | Paid plans required in production. Budget to be confirmed before M10 (Q11). |
| R10 | Migration deletes data | Additive-only migrations, CI check, backup before production migrations |
| R11 | Approved payment edited later | Locked after approval. Correct by Reverse + new entry. |
| R12 | Users confuse Pending and Waiting | Fixed colours and one-line help on every card |
| R13 | Booking ID no longer matches resort/year | Resort and booking-year changes blocked. Cancel + re-create. |
| R14 | Cancelled booking still shows the original amount as expected | Amount Due = Cancellation Charge; cancellation plan replaces the old plan |
| R15 | Refund larger than money held | Database check under a row lock |
| R16 | A user disables or takes over an Owner account, or nobody can log in as Owner | At least one active Owner is always required. Protected Owner actions only by another Owner, with password re-entry and a reason. Only Owners grant the Owner role. Alerts. Recovery script. Two Owner accounts recommended. |
| R18 | Historical expected figures silently change | Past due plan rows locked. Changes recorded as dated Expected Adjustments. |
| R17 | Manual amount adjustment misuse | Mandatory reason, calculated value kept, shown on PDF and in a filterable report |

## 10. Possible future features (not in version 1)
Room/cottage allocation, percentage discounts, agent commission, SMS/WhatsApp confirmations, GST invoices, expense tracking, other languages, offline mode, period locking (freezing past months).

## 11. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-11-11 | Scope and milestones accepted as in the project brief | Owner |
| 2026-11-11 | **Q4** Booking ID `{RESORT_CODE}-{YYYY}-{NNNNNN}`. Separate counter per resort, yearly reset, year = Booking Date year. Atomic. | Owner |
| 2026-11-11 | **Q5** Total Collection = approved payments only. Waiting shown separately and never counted as collection. Pending = Final − valid recorded payments. Verified Remaining = Final − approved. Overpayment shown separately. | Owner |
| 2026-11-11 | **Q6** Advance due on the booking date, Balance due on check-in. Amounts and dates editable. Plan sum must equal Final. | Owner |
| 2026-11-11 | **Q7** Cancellation and No-show with reason, date, charge. Refunds are separate auditable records. Nothing deleted or overwritten. | Owner |
| 2026-11-11 | **Q8** Self-approval allowed, shown as "Self-approved" and recorded in the audit history. | Owner |
| 2026-11-11 | **Q11** Deferred. Costs documented as estimates only. No subscriptions until confirmed before production. | Owner |
| 2026-11-11 | **Q1** Two pricing methods (per person per night; per person per stay) chosen in the form. Optional Extra Charges and Discount. Manual adjustment of the final amount only with a mandatory reason and audit history. | Owner |
| 2026-11-11 | **Q2** Stay Types: Resort Stay, Day Outing, Package. Editable list. | Owner |
| 2026-11-11 | **Q3** Agent, Partner and Own require a name. Direct needs no name. | Owner |
| 2026-11-11 | **Q6b** No automatic advance suggestion. The user enters the advance and balance. The plan must equal the final amount. | Owner |
| 2026-11-11 | **Q7a** After cancellation/no-show, the cancellation charge is the amount due. The original amount is shown separately and is no longer expected. | Owner |
| 2026-11-11 | **Q7b** Refunds have their own approval process, history and self-approval indicator. | Owner |
| 2026-11-11 | **Q7c** Cancellation: no default charge, user must enter it. No-show: pre-filled with the full amount, editable with a reason. | Owner |
| 2026-11-11 | **Q7d** Refunds shown separately. Net Collection = Approved Payments − Approved Refunds, by actual refund date. Total Collection stays approved payments only. | Owner |
| 2026-11-11 | **Q9** Proof mandatory for UPI, Card and Cheque. Optional for Cash and Other. | Owner |
| 2026-11-11 | **Q10** All users have the same access, including user management. All account actions audited. A user cannot disable their own account. Email + password login. Names shown in the app. | Owner |
| 2026-11-11 | **Q12** Refunds allowed against overpayments, as separate records with approval and audit history. | Owner |
| 2026-11-11 | **Q13** Booking amount changes allowed with reason, audit history, updated plan and new PDF. Existing payments preserved. | Owner |
| 2026-11-11 | **Q14** Rupee discounts only in version 1. | Owner |
| 2026-11-11 | **Q15** No room/cottage allocation in version 1. | Owner |
| 2026-11-11 | **Q16** Resort and booking-date year cannot change after the ID is issued. Correct by cancel + new booking. Same-year date changes allowed with audit history. | Owner |
| 2026-11-11 | **Q17** One combined card "Total Collection (Approved)". Waiting for Approval kept separate. | Owner |
| 2026-11-11 | **D1** Waiting refunds do not reduce Pending (or any other balance). Only approved refunds do. | Owner |
| 2026-11-11 | **D2** Historical expected figures stay unchanged after a due date has passed. Later cancellations/plan changes are recorded as separate dated adjustments with a reason. | Owner |
| 2026-11-11 | **D3** Refund proof rule = payment rule (mandatory UPI/Card/Cheque, optional Cash/Other). | Owner |
| 2026-11-11 | **D4** Nights calculated automatically from dates; minimum 1 for per-night pricing. | Owner |
| 2026-11-11 | **Owner protection** At least one active Owner always. Extra protection for disabling Owner accounts. Account recovery must be possible. Detailed rules O1–O4 proposed (§12.2). | Owner |
| 2026-11-11 | **O5, O6** Create only the owner's own first Owner account. The second Owner stays pending until details are provided: no fake email, no dummy Owner. The system must run securely with one active Owner and keep the "at least one active Owner" rule. Recovery limitations with one Owner are documented. The second Owner is added later by the existing Owner through the approved Owner management process. | Owner |
| 2026-11-11 | **O6 approved.** Adding another Owner requires the current Owner's password and a written reason. **M2 setup choices:** fictional test data only (never in real data; tests roll back); database tests run through GitHub Actions in a disposable database; the built-in Supabase email is used in development; database changes use Option B (database connection string), subject to CLI compatibility and security verification. | Owner |

## 12. Open items

### 12.1 Deferred
| # | Item | Needed before |
|---|---|---|
| Q11 | Hosting budget and provider subscriptions. Estimates and production requirements are in DEPLOYMENT_GUIDE §9. | M10 (development can use free tiers) |
| O-2nd | **Second Owner account.** Waiting for the person's name and real email address. Until then the system runs with one Owner (O5). It is added later in the app (O6). | Recommended before go-live (M10). The owner may instead sign off on the one-Owner limitations (SECURITY.md §3.2a). |
| O-1st | ~~First Owner account details~~ — name and email provided in chat 2026-11-11 (deliberately not stored in the repository). A temporary password is set when the account is created; the Owner must change it at first login. | Done |

### 12.2 Owner-account protection rules (O1–O4 accepted with M0 approval; O5–O6 decided 2026-11-11)
You asked for extra protection for Owner accounts. To make that protection actually work, the role has to matter for account actions on Owner accounts. Operational access stays equal for everyone.

| # | Rule | Why it is needed | Alternative |
|---|---|---|---|
| O1 | Disabling an Owner, resetting an Owner's password, changing an Owner's email or role: **only another active Owner** can do it. | If a Manager could reset an Owner's password, they could log in as the Owner, so "disable protection" alone would not protect the account. | Managers may also do it, but only with a reason + password re-entry + alert (weaker). |
| O2 | **Only an Owner can give the Owner role.** | Otherwise a Manager could promote themselves to Owner and then use O1. | — (needed for O1 to mean anything) |
| O3 | Protected Owner actions need a reason + the acting Owner's password re-entered, and every user sees a dashboard alert. | Prevents a mistake or misuse on an unattended logged-in device. | Reason only. |
| O4 | Recommended setup: **two Owner accounts**, MFA for Owners, and "Forgot password" email enabled for Owner accounts only. A server-side recovery script is the last resort. | With one Owner, a forgotten password could otherwise lock the business out of owner-level account control. | One Owner and the recovery script only. **Owner decision 2026-11-11: start with one Owner (O5); the second is pending.** |
| O5 | Start with **one real Owner**. Never create a dummy or fake-email Owner. All Owner protections still hold with one Owner. | Owner has no second person's details yet. | Block go-live until two Owners exist (rejected by owner). |
| O6 | The second Owner is added later by the existing Owner in the app (Add User, role Owner, reason, password re-entry, audit, alert). | Uses the already approved Owner management process, no special-case code. | Email invitation link (needs the production email sender; not version 1). |

With these rules, a Manager can still add, edit, disable, enable and reset **Manager** accounts, exactly as decided in Q10.
