# UI_UX_SPECIFICATION — Pages, Navigation, Forms and Flows

| Item | Value |
|---|---|
| Milestone | M0 (spec). Built in M3–M8. |
| Status | M0 final draft |
| Last updated | 2026-11-11 |

## 1. Design principles
1. **Simple words.** Use the PRD §4 labels. No accounting jargon.
2. **One screen, one job.** The primary button is at the top right on desktop, and sticky at the bottom on mobile.
3. **Big and readable.** 16px base font, touch targets of at least 44px, high contrast.
4. **Money is always formatted** `₹1,50,000`, right-aligned in tables. Fixed colour meanings:

| Meaning | Colour | Label |
|---|---|---|
| Total Collection (Approved) / Approved | Green | ✓ Approved |
| Waiting for Approval | Amber | ⏳ Waiting for Approval |
| Rejected | Red | ✕ Rejected |
| Reversed | Grey, amount struck through | ↩ Reversed |
| Pending Amount | Blue | |
| Extra Payment / Refund due | Purple | |
| Refund | Teal, shown with a "−" sign | |
| Self-approved | Small orange tag | Self-approved |
| Manual adjustment | Small grey tag | Adjusted |

   Colour is never the only signal: there is always an icon and text too.
5. **Forgiving forms:** inline plain-English errors, nothing lost on a failed save.
6. **Confirm only important actions:** Approve, Reject, Reverse, Cancel booking, Mark No-show, Disable user, Deactivate resort.
7. Light theme by default. Design tokens are set in M3.

## 2. Layout and navigation
- **Desktop/tablet:** left sidebar and a top bar (global search for Booking ID, mobile or guest name; resort filter; user menu showing the user's **name**).
- **Mobile:** top bar and a bottom navigation with 5 items: | Dashboard | Bookings | **＋ Add** | Approvals (badge) | More |

Menu items:
- Dashboard
- Bookings
- Add Booking
- Waiting for Approval (badge = waiting payments + refunds)
- Payments
- Refunds
- Calendar
- Guests
- Collection Reports
- Old Records
- Resorts
- Agents & Partners
- Activity
- Settings (Users, Stay Types, Payment Apps, System status)

Every user sees the same menu (Q10).

## 3. Pages

### 3.1 Login `/login` and Change Password `/change-password`
Email, password (show/hide) and a "Log in" button. Error: "Wrong email or password." There is no sign-up link. "Forgot password? Ask a team member to reset it." Owner accounts also get a "Send reset link to my email" option. The page always says "If this is an Owner account, a link has been sent", so it never reveals which emails exist.
After a first login or a reset, the user goes to Change Password first.

### 3.2 Dashboard `/dashboard` (Q17)
- Filters: Resort (All / each) · Date (Today, This Week, This Month, This Year, Custom).
- Row 1: Total Resorts · Total Bookings · Today's Check-ins · Today's Check-outs.
- Row 2 (money):
  - **Expected Collection** (by due date)
  - **Total Collection (Approved)** (by payment date), with the line "Refunds ₹X · Net Collection ₹Y" underneath
  - **Waiting for Approval** (separate amber card)
  - **Pending Amount**

  There is no separate "Paid and Approved" card. Each card has an "i" with a one-line meaning and the date used, and opens the matching report.
- Alerts: waiting items older than 3 days, overdue plans, self-approved count this period, failed PDFs, backup older than 36 h.
- Resort-wise table: Resort | Bookings | Expected | Total Collection (Approved) | Waiting | Refunds | Net | Pending.
- Date-wise chart (approved and waiting stacked, expected line).
- Recent bookings, recent payments, recent activity.

### 3.3 Bookings list `/bookings`
Search by Booking ID, name, mobile or C/O name. Filters: resort, status, date type (Booking/Check-in/Check-out) + range, C/O, pricing method, "Has Pending", "Has Waiting", "Refund due", "Adjusted".
Columns: Booking ID · Resort · Guest · Mobile · Check-in · PAX · Amount Due · Approved · Waiting · Pending · Status. Cards on mobile.

### 3.4 Add / Edit Booking `/bookings/new`, `/bookings/[id]/edit`
Sections (single column on mobile):
1. **Resort**: active resorts only. **Locked on edit** (note: "Resort cannot be changed after the Booking ID is issued. To fix it, cancel this booking and create a new one.").
2. **Guest**: Mobile first, matching guests suggested ("Use this guest"), then Name and optional details.
3. **Stay**: Stay Type (Resort Stay / Day Outing / Package / …) · Booking Date (default today; on edit, only dates in the same year can be picked) · Check-in date + time · Check-out date + time · PAX.
4. **C/O**: four big toggle buttons. Agent → agent picker (+ add new) · Partner → partner picker (+ add new) · Own → "Person / source name" (required, with suggestions) · Direct → no name field.
5. **Amount**:
   - **Pricing Method**: two big buttons, "Per person per night" or "Per person per stay".
   - Tariff Per Person.
   - Nights, shown automatically from the dates, e.g. "2 nights" (only used for per night).
   - Live line: "2 people × ₹2,500 × 2 nights = ₹10,000" (or "2 people × ₹2,500 = ₹5,000").
   - Extra Charges (optional) + description.
   - **Total Amount** (auto).
   - Discount (₹ only).
   - **Final Booking Amount** (large, auto).
   - Link "Change final amount": opens a field for the new Final Amount and a **required reason**. It shows "Calculated ₹9,500 → Final ₹9,000 (Adjusted −₹500)".
6. **Payment Plan**: rows "Advance – due [Booking Date] – ₹ ____" and "Balance – due [Check-in date] – ₹ ____". **Both amounts start empty; nothing is suggested.** Users can edit due dates, add rows and remove rows. A live check reads "Plan total ₹X of ₹Y ✓", or in red "Plan is ₹500 short / ₹500 more than the Final Amount".
7. **Remarks**.
8. **Reason for change**: shown on edit when any amount field changed (required).
9. Buttons: **Save Booking** · "Save and Add Payment" · Cancel.

On edit with an amount change, the plan section is highlighted ("Final Amount changed. Please update the payment plan.").

**Plan editor on later changes (D2):**
- Past due rows are shown greyed with a lock icon: "Advance ₹2,000 – due 1 Oct – locked (already due)".
- A summary line reads "Amount Due ₹4,500 · Already due (locked) ₹2,000 · Adjustments ₹0 · **Amount still to plan ₹2,500**". New rows (due today or later) must add up to the amount still to plan.
- If the amount still to plan is negative: an amber box "Expected will be reduced by ₹1,000 today (adjustment). Reason: [required]". No new rows are needed.
- Option "Move unpaid amount to a new date" for an overdue amount: choose the amount and give a reason, then add the new row(s).
If the check-in date changes, a note reads "Check the Balance due date".
On save, a toast: "Booking RSA-2026-000123 saved. PDF is being prepared."

### 3.5 Booking page `/bookings/[id]`
- Header: Booking ID (copy), resort logo/name, status badge, [Add Payment] [Edit] [Download PDF] [⋯ Check-in · Check-out · Cancel Booking · Mark No-show · Add Refund].
- **Money box**: Amount Due · Total Collection (Approved) · Waiting for Approval · Refunds (Approved) · Net Collection · Pending Amount · Verified Remaining · Extra Payment / Refund due (only if > 0) · Rejected/Reversed (small, only if > 0).
- **Refunds Waiting for Approval** is a separate small amber line (e.g. "Refund ₹2,000 waiting for approval · still to record ₹0"). It does not change any number above it (D1).
- For cancelled/no-show bookings: a red banner "Cancelled on 12 Nov 2026 by Ramesh Kumar · Reason: … · Cancellation charge ₹1,000 (Original Booking Amount ₹5,000)". The money box uses the charge as the Amount Due.
- Tabs:
  1. **Details**: guest, stay, C/O, pricing breakdown, adjustment + reason, remarks, entered/updated by and at.
  2. **Payments & Refunds**: the payment list (status, proof thumbnails, inline Approve/Reject for waiting) and a separate Refunds list (same layout, "Add Refund" button). On an **Approved** payment or refund there is an **"Add correction file"** link (Q9a): it asks for the file(s) and a written reason (at least 10 characters), with the note "The original files and the amounts will not change." Correction files appear under the originals with an orange tag **"Added after approval"** showing the date, the person and the reason. Original files have no "hide" button once the item is decided. When **Reverse** is refused because refunds depend on the payment, the message reads: "This payment cannot be reversed because refunds depend on it. Reject or reverse the refunds first." with links to those refunds.
  3. **Payment Plan**: active rows (past due ones locked) with due date, amount, covered, outstanding and an overdue tag. An **Expected Adjustments** list (date, amount, reason, user). Plan revisions history (v1, v2, … with reason). "Change plan" (reason). Toggle "Show replaced rows".
  4. **PDFs**: versions (current marked) with date, reason and download.
  5. **History**: plain-English audit timeline for the booking, plan, payments and refunds.

### 3.6 Cancel Booking / Mark No-show dialog (Q7, Q7a, Q7c)
- Reason (required) · Date (default today).
- **Cancellation Charge**:
  - Cancel: **empty, must be typed** (₹0 allowed). Help text: "Amount the resort keeps."
  - No-show: **pre-filled with the Final Booking Amount**. If changed, a "Reason for changing the charge" field appears (required).
- Plan preview (D2): "Already due (locked) ₹X". Then either a cancellation row for the amount still to plan (due today, editable to later dates, can be split), or the notice "Expected reduced by ₹Y today (adjustment)".
- Summary: "Already approved ₹3,000 → Refund due ₹2,000".
- Confirm button: "Cancel this booking" / "Mark as No-show".

### 3.7 Add Payment (page or sheet)
- Booking summary at the top.
- Fields: Amount (helper button "Fill pending ₹3,500") · Method (5 big buttons) · Provider (for UPI/Card) · Payment Date (no future dates) · Time (optional) · Reference Number (label changes by method) · **Payment Screenshot / Receipt** (labelled "Required" for UPI/Card/Cheque and "Optional" for Cash/Other) · Remarks.
- Amber warnings (they don't block saving): above the pending amount, duplicate reference, duplicate screenshot.
- **Add Payment** stays disabled until uploads finish, and it is protected against double taps. Toast: "Payment of ₹1,500 added. Waiting for approval."

### 3.8 Add Refund (sheet)
- Shows: Approved ₹X · Refunds so far ₹Y · Refund due ₹Z · "Most you can refund: ₹(A−RA−RW)".
- Fields: Amount · Method · Provider · Refund Date · Time · Reference · Reason (quick picks: "Booking cancelled", "Guest paid extra", other) · Proof (same rule as payments) · Remarks.
- Toast: "Refund of ₹2,000 recorded. Waiting for approval."

### 3.9 Waiting for Approval `/approvals`
- Tabs: **Payments** | **Refunds**. Filters: resort, date, recorded by. Oldest first.
- Review panel: large screenshot viewer (zoom, swipe, PDF) next to the details, the booking money box and the approval history.
- **Approve** (green) · **Reject** (red, reason required with quick picks). On approved items (in the Payments/Refunds lists): **Reverse** (reason, strong confirmation).
- If you recorded the item: an orange note "You recorded this. It will be marked Self-approved." Approval is allowed (Q8).
- After an action, the next item opens automatically.

### 3.10 Payments `/payments` and Refunds `/refunds`
All records with filters: status, method, provider, resort, payment/refund date or entry date, recorded by, self-approved.

### 3.11 Calendar `/calendar`
Month view (desktop), agenda/week view (mobile). Resort filter, Today button, no limit on past/future navigation. Day cells show check-ins/outs and due/collected amounts.
Day page `/calendar/[date]` tabs: Check-ins · Check-outs · Staying · Payments Received · Refunds · Payments Due, each with quick actions. "Add Booking for this date".

### 3.12 Guests, and Settings → Resorts / C/O (built in M2: `/settings`, `/settings/resorts`, `/settings/co`)
- Guests: search, detail page with booking history and totals.
- **Settings → Resorts** `/settings/resorts`: every resort in a searchable list (switched-off ones too); add without limit; edit name, location, contact number; logo upload (PNG/JPG/WEBP ≤ 2 MB, straight to private storage, content checked by the server); the **Code is read-only after the first booking** with the explanation; "Switch off" with an explanation that past bookings stay. Four placeholder resorts are there at the start and say they are examples.
- **Settings → C/O** `/settings/co`: add any category (name + kind: pick from a list / type a name / no name); per category: change it, switch it off, and for a list category a searchable list of its names with add/edit/switch off.
- Booking forms (M4) use the shared type-to-search picker (`OptionPicker`): only switched-on choices are offered; an old booking still shows its own (even switched-off) choice. Managers and Owners have the same access to all of these screens.

### 3.13 Collection Reports `/reports`
Report cards per PRD §5.16 (including Refund Report and Cancellation Report). Each report: filters → summary row → table → [Download CSV] [Download PDF]. The header states the date and rule used, e.g. "Collection by payment date · Approved payments only · Refunds by refund date · IST".

### 3.14 Old Records `/old-records`
Advanced search across bookings, payments and refunds for any date range, with links to screenshots, history and PDF versions.

### 3.15 Activity `/activity`
Audit timeline with filters (user, action, record type, resort, date), including user-account actions. Each entry expands to show old → new values.

### 3.16 Settings → Users `/settings/users` (Q10)
- Visible to every user.
- List: Name · Email · Role label · Status · Last login.
- **Add User**: full name, email, role label (Owner/Manager), temporary password (with a generate button). The new user must change it at first login.
- Edit name/role · **Reset Password** (new temporary password) · **Disable / Enable**.
- On your own row, the Disable button is replaced by the text "You cannot disable your own account".
- Every action asks for confirmation and appears in Activity.
- **Owner accounts** have an "Owner" badge with a shield.
  - Managers see no Disable / Reset Password / Change Email / Change Role buttons on Owner rows. Instead: "Only another Owner can change this account".
  - The "Owner" role option appears only for Owners.
  - When an Owner performs one of these actions on another Owner: a dialog asks for a reason and "Enter your password to confirm".
  - The last active Owner shows "This is the only active Owner. Add another Owner first."
- While there is only one active Owner, a notice is shown to Owners on the dashboard and at the top of this page: "Only one Owner account exists. If you lose your password and email access, access can be recovered only with technical help. Add a second Owner when you can." with a button **Add second Owner** that opens Add User with the role set to Owner.
- Add User with role **Owner** is available only to Owners. It asks for a reason and the Owner's own password, and is shown as a dashboard alert to all users (O6).

### 3.17 Settings → Stay Types / Payment Apps / System status
**Stay Types** `/settings/stay-types` (built in M2): add any number, rename, switch on/off, searchable; the first three are marked as examples. Payment apps and the system status follow in later milestones. Add, rename and deactivate items in the lists. The system page shows the PDF queue, last backup and data checks.

### 3.18 My Account `/account` (every user)
- Shows name, email, role label. The role is read-only.
- **Change my password** (current password, new password).
- **Change my email** (O7): fields "Current password" and "New email address", button "Send confirmation". Then a clear waiting message: "We sent a link to your new address (and to your old address). Your email will change only after you open the link(s). Until then, keep using your old email to log in." A "Cancel request" link is shown while pending. After confirmation the page shows a green note with the date.
- For a sole Owner, a short reminder: "Keep access to both mailboxes until the change is confirmed."

## 4. Key user flows
- **F1 New booking with advance:** Add → Booking → choose per night → fill → plan: Advance ₹2,000 (booking date) + Balance ₹7,500 (check-in), total ✓ → Save and Add Payment → ₹2,000 UPI + screenshot (required) → booking shows Waiting ₹2,000, Pending ₹7,500. PDF v1 then v2.
- **F2 Approving:** Dashboard "6 waiting" → Approvals → compare screenshot → Approve → next → Reject with reason. PDFs are regenerated automatically.
- **F3 Balance at check-in:** Calendar → Today → Check-ins → Add Payment (cash, proof optional) → Mark Checked-in.
- **F4 Correcting mistakes:**
  - Payment still waiting: edit (reason) or reject.
  - Payment approved: Reverse (reason), then add the correct payment.
  - Wrong resort or year on a booking: Cancel (charge ₹0, reason "Entered under wrong resort") → create a new booking.
- **F5 Amount change after approval:** Edit → discount ₹1,000 → reason → update the plan → Save → new PDF. Approved payments are unchanged. If they are now above the new amount, the booking shows Refund due → Add Refund.
- **F6 Cancellation with refund:** Cancel → reason, charge ₹1,000 (typed) → "Refund due ₹2,000" → Add Refund → approve → Net Collection ₹1,000, Refund due ₹0.
- **F7 No-show:** Mark No-show → charge pre-filled ₹5,000 → keep or change it (reason) → confirm.
- **F8 Monthly check:** Reports → Monthly Collection → Expected vs Total Collection (Approved) vs Waiting, plus Refunds and Net → Download PDF.
- **F9 Old record:** search a mobile → guest → 2027 booking → PDFs tab → v1.
- **F10 Staff leaves:** Settings → Users → Disable (confirm) → logged in Activity.

## 5. Responsive rules
Breakpoints: < 640 mobile, 640–1024 tablet, > 1024 desktop. Tables become cards on mobile, and report tables keep their first column sticky. Forms are a single column on mobile. File inputs use `accept="image/*,application/pdf"` with the camera available.

## 6. Accessibility
Visible labels on all fields. Errors linked to fields with `aria-describedby`. Keyboard navigable. WCAG AA contrast. Dates shown as `12 Nov 2026`, times as `4:05 PM`.

## 7. Empty, loading and error states
- Empty: a friendly message plus the next step.
- Loading: skeletons. Buttons show a spinner and are disabled while saving.
- Error: plain text plus "Try again".
- Offline: banner "No internet. Your changes are not saved yet."
