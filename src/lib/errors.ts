/**
 * Plain-English messages for the error codes the database can raise
 * (RAISE EXCEPTION 'CODE' in supabase/migrations). Managers never see the codes.
 * tests/unit/errors.test.ts checks that EVERY code used in a migration has a message here,
 * so a new rule cannot ship with a technical error screen.
 */
export const DB_ERROR_MESSAGES: Record<string, string> = {
  // accounts
  NOT_ALLOWED: "You are not allowed to do this.",
  NOT_AUTHENTICATED: "Your sign-in has expired. Please sign in again.",
  OWNER_ACTION_REQUIRES_OWNER:
    "Only another Owner can do this to an Owner account.",
  LAST_OWNER_PROTECTED:
    "This is the only active Owner. Add another Owner first.",
  CANNOT_DISABLE_SELF: "You cannot switch off your own account.",
  CANNOT_CHANGE_OWN_ROLE: "You cannot change your own role.",
  CANNOT_RESET_OWN_PASSWORD: "To change your own password, use My Account.",
  EMAIL_CHANGE_REQUIRES_VERIFICATION:
    "To change your own email, use My Account and confirm the link we send you.",
  ACCOUNT_DISABLED: "Switch the account on before resetting its password.",
  DUPLICATE_ACCOUNT: "An account with this email already exists.",
  PROFILE_NOT_FOUND: "That person was not found.",
  AUTH_USER_MISSING: "The login for this person could not be created.",
  AUTH_EMAIL_MISMATCH: "The email does not match the login.",
  FIRST_USER_MUST_BE_OWNER: "The first account must be an Owner.",
  NEW_USER_MUST_BE_ACTIVE: "A new account must start switched on.",
  // general
  REASON_REQUIRED:
    "Please write a reason (at least 5 letters; Owner actions and correction files need at least 10).",
  INVALID_INPUT: "Please check what you typed and try again.",
  NOT_FOUND: "We could not find that record.",
  DUPLICATE: "That name already exists.",
  STALE_RECORD: "Someone else changed this just now. Please reload the page.",
  ALREADY_DECIDED: "Someone has already decided this.",
  DELETE_NOT_ALLOWED: "Records are never deleted.",
  RECORD_IS_APPEND_ONLY: "This record can no longer be changed.",
  IMMUTABLE_FIELD: "That detail can no longer be changed.",
  // resorts, booking numbers
  RESORT_CODE_LOCKED:
    "The resort code cannot be changed after the resort has bookings.",
  RESORT_INACTIVE:
    "New bookings cannot be added to a resort that is switched off.",
  ID_FIELDS_LOCKED:
    "The resort and the year of the booking date cannot be changed after the Booking ID is issued.",
  BOOKING_NUMBER_LIMIT:
    "No more booking numbers are available for this resort and year.",
  BOOKING_NOT_FOUND: "We could not find that booking.",
  BOOKING_MUST_START_CONFIRMED: "A new booking must start as Confirmed.",
  // bookings
  INVALID_DATES:
    "Check-out must be after check-in (and a per-night stay needs at least one night).",
  AMOUNT_TOO_LARGE: "That amount is too large.",
  DISCOUNT_TOO_LARGE: "The discount cannot be more than the total amount.",
  FINAL_NEGATIVE: "The final amount cannot be below zero.",
  ADJUSTMENT_REASON_REQUIRED:
    "Please give a reason of at least 5 characters for changing the final amount.",
  CO_TYPE_MISMATCH:
    "Please choose a C/O category and, if it has a list, a name from that list.",
  CO_INACTIVE: "This C/O category or name is switched off.",
  STAY_TYPE_INACTIVE: "Please choose a stay type that is switched on.",
  CANCELLED_AMOUNTS_LOCKED:
    "The original amounts of a cancelled booking cannot be changed.",
  CANCELLATION_RECORD_LOCKED: "The cancellation record cannot be changed.",
  CANCELLATION_DATE_FUTURE: "The cancellation date cannot be in the future.",
  CHARGE_REQUIRED: "Please enter the cancellation charge (it can be zero).",
  CHARGE_OUT_OF_RANGE:
    "The charge must be between zero and the final booking amount.",
  CHARGE_CHANGE_REASON_REQUIRED:
    "Please give a new reason for changing the cancellation charge.",
  STATUS_FINAL: "A cancelled or no-show booking cannot be reopened.",
  STATUS_NOT_ALLOWED: "This status change is not allowed.",
  INVALID_STATUS_CHANGE: "This status change is not allowed.",
  // payment plan
  PLAN_TOTAL_MISMATCH:
    "The payment plan must add up to exactly the amount to be planned.",
  PLAN_DATE_IN_PAST: "New plan rows must be due today or later.",
  PAST_DUE_ROW_LOCKED: "A plan row that is already due cannot be changed.",
  PLAN_ROW_IMMUTABLE:
    "Plan rows cannot be edited. They can only be replaced by a new plan.",
  PLAN_REVISION_CLOSED:
    "The payment plan could not be updated. Please try again.",
  PLAN_REVISION_ORDER:
    "The payment plan could not be updated. Please try again.",
  PLAN_REVISION_AMOUNT_MISMATCH:
    "The payment plan could not be updated. Please try again.",
  ADJUSTMENT_DATE_INVALID:
    "The payment plan could not be updated. Please try again.",
  MOVE_OVERDUE_TOO_LARGE:
    "You can only move an amount that is overdue and still unpaid.",
  // payments and refunds
  PAYMENT_DATE_IN_FUTURE: "The payment date cannot be in the future.",
  REFUND_DATE_IN_FUTURE: "The refund date cannot be in the future.",
  PAYMENT_ON_CANCELLED:
    "There is no unpaid cancellation charge to collect on this booking.",
  PAYMENT_LOCKED: "A decided payment cannot be changed.",
  REFUND_LOCKED: "A decided refund cannot be changed.",
  PAYMENT_MUST_START_WAITING:
    "A new payment must start as Waiting for approval.",
  REFUND_MUST_START_WAITING: "A new refund must start as Waiting for approval.",
  PAYMENT_CHANGED_DURING_DECISION:
    "A payment cannot be edited while it is being approved or rejected.",
  REFUND_CHANGED_DURING_DECISION:
    "A refund cannot be edited while it is being approved or rejected.",
  REFUND_TOO_LARGE:
    "That is more than can be refunded now. A running booking can only refund what was paid above the amount due; a cancelled booking can refund the approved money held. Refunds waiting for approval count too.",
  REFUND_NOT_ALLOWED:
    "This booking has not been overpaid, so there is nothing to refund.",
  REVERSAL_EXCEEDS_REFUNDS:
    "This payment cannot be reversed because refunds depend on it. Reject or reverse the refunds first.",
  // files
  PROOF_REQUIRED:
    "A screenshot or receipt is required for UPI, card and cheque.",
  PROOF_LOCKED:
    "The files of a decided payment or refund cannot be changed. Use “Add correction file”.",
  PROOF_CORRECTION_NOT_ALLOWED:
    "Correction files are only for approved payments and refunds.",
  INVALID_FILE:
    "That file could not be accepted. Use a JPG, PNG, WEBP or PDF up to 10 MB.",
  TOO_MANY_FILES: "You can add at most 5 files.",
};

export const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Turns a database/API error into a sentence for the screen. Only the code is
 * used; anything unknown becomes the general message (never raw database text).
 */
export function friendlyError(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : typeof error === "string"
        ? error
        : "";
  const code = message.trim();
  return DB_ERROR_MESSAGES[code] ?? GENERIC_ERROR;
}

/** Warnings returned by add_payment / add_refund (they never block saving). */
export const WARNING_MESSAGES: Record<string, string> = {
  DUPLICATE_REFERENCE:
    "This reference number is already used on another record.",
  DUPLICATE_FILE: "The same file is already attached to another record.",
  ABOVE_AMOUNT_DUE:
    "With this payment the booking is paid above its amount due.",
  ABOVE_REFUND_DUE: "This is more than the refund due for this booking.",
};
