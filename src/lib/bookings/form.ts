/**
 * The booking form's rules, as plain functions (no Next.js, no database), so every rule is unit-tested.
 * The form sends INPUTS only (people, tariff, extras, discount, a changed final amount, the dates); the database
 * recalculates nights and every amount (FR-BK-5) and is the source of truth. Everything here is a preview and a
 * friendly check before saving: it must never be able to save something the database would refuse without a plain
 * message, and it never lets a person type the number of nights.
 *
 * Dates are plain IST calendar dates ("2026-11-12") and 24-hour times ("14:30"); money is whole paise.
 */
import {
  CalcError,
  computeBookingAmounts,
  type PricingMethod,
} from "@/lib/calc";
import { daysBetween, isIsoDate, todayIst } from "@/lib/dates";
import { MoneyError, formatPaise, parseRupeesToPaise } from "@/lib/money";

export type { PricingMethod };

export interface PlanRowInput {
  label: string;
  dueDate: string;
  /** rupees as typed; EMPTY at the start (nothing is suggested) */
  amount: string;
}

export interface BookingFormValues {
  resortId: string;
  /** an existing guest chosen from the suggestions, or null for a new one */
  guestId: string | null;
  guestName: string;
  guestMobile: string;
  guestEmail: string;
  stayTypeId: string;
  bookingDate: string;
  checkInDate: string;
  checkInTime: string;
  checkOutDate: string;
  checkOutTime: string;
  pax: string;
  coCategoryId: string;
  coEntryId: string | null;
  coName: string;
  pricingMethod: PricingMethod | "";
  tariff: string;
  extra: string;
  extraNote: string;
  discount: string;
  /** the person opened "Change final amount" */
  changeFinal: boolean;
  finalOverride: string;
  adjustmentReason: string;
  plan: PlanRowInput[];
  remarks: string;
  /** edit only: why an amount changed */
  changeReason: string;
}

export const DEFAULT_CHECK_IN_TIME = "14:00";
export const DEFAULT_CHECK_OUT_TIME = "11:00";
export const MIN_REASON = 5;
export const MAX_PLAN_ROWS = 24;

/** A blank form. The two starting plan rows have NO amounts (nothing is suggested). */
export function emptyForm(today: string = todayIst()): BookingFormValues {
  return {
    resortId: "",
    guestId: null,
    guestName: "",
    guestMobile: "",
    guestEmail: "",
    stayTypeId: "",
    bookingDate: today,
    checkInDate: "",
    checkInTime: DEFAULT_CHECK_IN_TIME,
    checkOutDate: "",
    checkOutTime: DEFAULT_CHECK_OUT_TIME,
    pax: "",
    coCategoryId: "",
    coEntryId: null,
    coName: "",
    pricingMethod: "",
    tariff: "",
    extra: "",
    extraNote: "",
    discount: "",
    changeFinal: false,
    finalOverride: "",
    adjustmentReason: "",
    plan: [
      { label: "Advance", dueDate: today, amount: "" },
      { label: "Balance", dueDate: "", amount: "" },
    ],
    remarks: "",
    changeReason: "",
  };
}

/** Money typed in rupees -> paise. Empty = `emptyAs` (default 0). Returns an error message for nonsense. */
export function rupees(
  text: string,
  emptyAs: number | null = 0,
): { paise: number } | { error: string } {
  if (text.trim() === "") {
    return emptyAs === null
      ? { error: "Please enter an amount." }
      : { paise: emptyAs };
  }
  try {
    return { paise: parseRupeesToPaise(text) };
  } catch (e) {
    return {
      error:
        e instanceof MoneyError ? e.message : "Please enter a valid amount.",
    };
  }
}

/** Nights are never typed: the IST date of check-out minus the IST date of check-in. */
export function nightsOf(
  checkInDate: string,
  checkOutDate: string,
): number | null {
  if (!isIsoDate(checkInDate) || !isIsoDate(checkOutDate)) return null;
  return daysBetween(checkInDate, checkOutDate);
}

export function nightsText(nights: number | null): string {
  if (nights === null) return "";
  return `${nights} ${nights === 1 ? "night" : "nights"}`;
}

export interface AmountPreview {
  ok: true;
  nights: number;
  basePaise: number;
  totalPaise: number;
  calculatedFinalPaise: number;
  manualAdjustmentPaise: number;
  finalPaise: number;
  /** "2 people × ₹2,500 × 2 nights = ₹10,000" */
  line: string;
}
export type AmountResult =
  AmountPreview | { ok: false; problem: string | null };

/**
 * The live amount lines. `problem` is null while the form is simply not filled in yet (show nothing), and a plain
 * sentence when something typed cannot work.
 */
export function previewAmounts(v: BookingFormValues): AmountResult {
  const nights = nightsOf(v.checkInDate, v.checkOutDate);
  if (
    nights === null ||
    v.pricingMethod === "" ||
    v.pax.trim() === "" ||
    v.tariff.trim() === ""
  ) {
    return { ok: false, problem: null };
  }
  if (
    nights < 0 ||
    (nights === 0 && v.pricingMethod === "per_person_per_night")
  ) {
    return {
      ok: false,
      problem:
        v.pricingMethod === "per_person_per_night"
          ? "Check-out must be on a later day than check-in for a per-night stay."
          : "Check-out cannot be before check-in.",
    };
  }
  const pax = Number(v.pax);
  if (!/^\d+$/.test(v.pax.trim()) || pax < 1 || pax > 1000) {
    return {
      ok: false,
      problem: "The number of people must be between 1 and 1000.",
    };
  }
  const tariff = rupees(v.tariff, null);
  const extra = rupees(v.extra);
  const discount = rupees(v.discount);
  for (const x of [tariff, extra, discount])
    if ("error" in x) return { ok: false, problem: x.error };
  let finalOverride: number | undefined;
  if (v.changeFinal && v.finalOverride.trim() !== "") {
    const f = rupees(v.finalOverride, null);
    if ("error" in f) return { ok: false, problem: f.error };
    finalOverride = f.paise;
  }
  try {
    const a = computeBookingAmounts({
      pricingMethod: v.pricingMethod,
      pax,
      tariffPerPersonPaise: (tariff as { paise: number }).paise,
      nights,
      extraChargesPaise: (extra as { paise: number }).paise,
      discountPaise: (discount as { paise: number }).paise,
      finalOverridePaise: finalOverride,
      // the reason is checked separately (with the 5-letter minimum), so only the amounts are previewed here
      adjustmentReason: finalOverride === undefined ? undefined : "x",
    });
    const perNight = v.pricingMethod === "per_person_per_night";
    const t = (tariff as { paise: number }).paise;
    const line = `${pax} ${pax === 1 ? "person" : "people"} × ${formatPaise(t)}${perNight ? ` × ${nightsText(nights)}` : ""} = ${formatPaise(a.basePaise)}`;
    return { ok: true, nights, ...a, line };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, problem: e.message };
    return { ok: false, problem: "Please check the amounts." };
  }
}

export interface PlanCheck {
  sumPaise: number;
  /** final - sum: positive = the plan is short, negative = the plan is more */
  diffPaise: number;
  state: "ok" | "short" | "over" | "empty";
  /** a plain sentence, or null when there is nothing to say */
  text: string | null;
  /** a row has a bad amount, a missing label or a missing date */
  rowProblems: (string | null)[];
}

/** "Plan total ₹X of ₹Y ✓", or in red "Plan is ₹500 short / ₹500 more than the Final Amount". */
export function checkPlan(
  rows: readonly PlanRowInput[],
  targetPaise: number | null,
  what = "Final Amount",
): PlanCheck {
  let sum = 0;
  const rowProblems = rows.map((r) => {
    if (r.label.trim() === "" || r.label.trim().length > 60)
      return "Give this row a name of up to 60 letters.";
    if (!isIsoDate(r.dueDate)) return "Choose the due date.";
    const a = rupees(r.amount, null);
    if ("error" in a) return a.error;
    if (a.paise <= 0) return "The amount must be more than zero.";
    sum += a.paise;
    return null;
  });
  if (targetPaise === null) {
    return {
      sumPaise: sum,
      diffPaise: 0,
      state: "empty",
      text: null,
      rowProblems,
    };
  }
  const diff = targetPaise - sum;
  if (rows.length === 0 && targetPaise === 0) {
    return {
      sumPaise: 0,
      diffPaise: 0,
      state: "ok",
      text: `Plan total ${formatPaise(0)} of ${formatPaise(0)} ✓`,
      rowProblems,
    };
  }
  if (diff === 0) {
    return {
      sumPaise: sum,
      diffPaise: 0,
      state: "ok",
      text: `Plan total ${formatPaise(sum)} of ${formatPaise(targetPaise)} ✓`,
      rowProblems,
    };
  }
  return {
    sumPaise: sum,
    diffPaise: diff,
    state: diff > 0 ? "short" : "over",
    text:
      diff > 0
        ? `Plan is ${formatPaise(diff)} short of the ${what} (${formatPaise(sum)} of ${formatPaise(targetPaise)}).`
        : `Plan is ${formatPaise(-diff)} more than the ${what} (${formatPaise(sum)} of ${formatPaise(targetPaise)}).`,
    rowProblems,
  };
}

export type FormErrors = Partial<Record<string, string>>;

/**
 * Friendly checks before saving. Returns plain-English messages keyed by field. The database checks everything again.
 * `mode`: "create" needs a resort and a plan that matches; "edit" does not ask for the resort (it is locked) and asks for
 * a reason when an amount changed (`amountChanged`).
 */
export function validateBooking(
  v: BookingFormValues,
  opts: {
    mode: "create" | "edit";
    amountChanged?: boolean;
    planRequired?: boolean;
  },
): FormErrors {
  const e: FormErrors = {};
  if (opts.mode === "create" && !v.resortId)
    e.resortId = "Please choose a resort.";
  if (!v.guestId) {
    if (v.guestName.trim() === "")
      e.guestName = "Please enter the guest's name.";
    else if (v.guestName.trim().length > 120)
      e.guestName = "The name is too long (120 letters at most).";
    const digits = v.guestMobile.replace(/\D/g, "");
    if (digits.length < 5 || digits.length > 20)
      e.guestMobile = "Please enter a valid mobile number.";
    if (
      v.guestEmail.trim() !== "" &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.guestEmail.trim())
    ) {
      e.guestEmail = "That does not look like an email address.";
    }
  }
  if (!v.stayTypeId) e.stayTypeId = "Please choose the stay type.";
  if (!isIsoDate(v.bookingDate))
    e.bookingDate = "Please choose the booking date.";
  if (!isIsoDate(v.checkInDate))
    e.checkInDate = "Please choose the check-in date.";
  if (!isIsoDate(v.checkOutDate))
    e.checkOutDate = "Please choose the check-out date.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.checkInTime))
    e.checkInTime = "Please enter the check-in time.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.checkOutTime))
    e.checkOutTime = "Please enter the check-out time.";
  if (!e.checkInDate && !e.checkOutDate && !e.checkInTime && !e.checkOutTime) {
    const inAt = `${v.checkInDate}T${v.checkInTime}`;
    const outAt = `${v.checkOutDate}T${v.checkOutTime}`;
    if (outAt <= inAt) e.checkOutDate = "Check-out must be after check-in.";
  }
  if (!v.coCategoryId)
    e.coCategoryId = "Please choose Agent, Partner, Own or Direct.";
  if (!v.pricingMethod) e.pricingMethod = "Please choose the pricing method.";
  const amounts = previewAmounts(v);
  if (!amounts.ok && amounts.problem) {
    e.amount = amounts.problem;
  } else if (!amounts.ok) {
    if (v.pax.trim() === "") e.pax = "Please enter the number of people.";
    if (v.tariff.trim() === "")
      e.tariff = "Please enter the tariff per person.";
  }
  if (v.changeFinal) {
    if (v.finalOverride.trim() === "")
      e.finalOverride = "Please enter the new final amount, or close this box.";
    else if (
      amounts.ok &&
      amounts.manualAdjustmentPaise !== 0 &&
      v.adjustmentReason.trim().length < MIN_REASON
    ) {
      e.adjustmentReason =
        "Please say why the final amount is changed (at least 5 letters).";
    }
  }
  if (
    opts.mode === "edit" &&
    opts.amountChanged &&
    v.changeReason.trim().length < MIN_REASON
  ) {
    e.changeReason = "Please say why the amount changed (at least 5 letters).";
  }
  if (v.plan.length > MAX_PLAN_ROWS)
    e.plan = `A payment plan can have at most ${MAX_PLAN_ROWS} rows.`;
  if (opts.mode === "create" || opts.planRequired) {
    if (amounts.ok) {
      const c = checkPlan(v.plan, amounts.finalPaise);
      if (c.state !== "ok")
        e.plan = c.text ?? "Please complete the payment plan.";
      else if (c.rowProblems.some(Boolean))
        e.plan = "Please complete every row of the payment plan.";
    }
  }
  return e;
}

const isoAt = (date: string, time: string) => `${date}T${time}:00+05:30`;

export interface BookingPayload {
  payload: Record<string, unknown>;
  plan: { label: string; due_date: string; amount_paise: number }[];
}

/**
 * The inputs the database function wants. Nights, base and final amounts are NOT sent: only the inputs, and the change
 * of the final amount as `manual_adjustment_paise` (final - calculated final) with its reason.
 * Throws if the form is not valid (callers run validateBooking first).
 */
export function buildPayload(
  v: BookingFormValues,
  mode: "create" | "edit",
): BookingPayload {
  const a = previewAmounts(v);
  if (!a.ok) throw new Error(a.problem ?? "The amounts are not complete.");
  const money = (t: string) => (rupees(t) as { paise: number }).paise;
  const payload: Record<string, unknown> = {
    stay_type_id: Number(v.stayTypeId),
    booking_date: v.bookingDate,
    check_in_at: isoAt(v.checkInDate, v.checkInTime),
    check_out_at: isoAt(v.checkOutDate, v.checkOutTime),
    pax: Number(v.pax),
    co_category_id: Number(v.coCategoryId),
    co_entry_id: v.coEntryId,
    co_name: v.coName.trim() === "" ? null : v.coName.trim(),
    pricing_method: v.pricingMethod,
    tariff_paise: money(v.tariff),
    extra_charges_paise: money(v.extra),
    extra_charges_note: v.extraNote.trim() === "" ? null : v.extraNote.trim(),
    discount_paise: money(v.discount),
    manual_adjustment_paise: a.manualAdjustmentPaise,
    manual_adjustment_reason:
      a.manualAdjustmentPaise === 0 ? null : v.adjustmentReason.trim(),
    remarks: v.remarks.trim() === "" ? null : v.remarks.trim(),
  };
  if (mode === "create") payload.resort_id = v.resortId;
  if (v.guestId) payload.guest_id = v.guestId;
  else {
    payload.guest_name = v.guestName.trim();
    payload.guest_mobile = v.guestMobile.trim();
    payload.guest_email =
      v.guestEmail.trim() === "" ? null : v.guestEmail.trim();
  }
  return { payload, plan: buildPlanRows(v.plan) };
}

/**
 * The plan rows for the database. A row without a usable amount is left out; callers check the plan first
 * (checkPlan / checkEditPlan), which refuses such rows, so nothing is ever dropped silently on a real save.
 */
export function buildPlanRows(rows: readonly PlanRowInput[]) {
  return rows.flatMap((r) => {
    const a = rupees(r.amount, null);
    if ("error" in a) return [];
    return [
      { label: r.label.trim(), due_date: r.dueDate, amount_paise: a.paise },
    ];
  });
}

/** Keep the rows the way a person left them, but start the Balance row on the check-in date once it is known. */
export function suggestDueDates(
  plan: readonly PlanRowInput[],
  checkInDate: string,
): PlanRowInput[] {
  if (!isIsoDate(checkInDate)) return [...plan];
  return plan.map((r) =>
    r.label === "Balance" && r.dueDate === ""
      ? { ...r, dueDate: checkInDate }
      : r,
  );
}

// ------------------------------------------------------------ editing an existing booking
const istDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const istTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** An instant as the IST date and 24-hour time the form shows: "2026-11-12T08:30:00Z" -> { date: "2026-11-12", time: "14:00" }. */
export function splitIst(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return { date: istDateFmt.format(d), time: istTimeFmt.format(d) };
}

/** Whole rupees stay whole ("2500"); paise are shown only when present ("2500.50"). */
export function paiseText(paise: number): string {
  const r = Math.trunc(paise / 100);
  const rest = Math.abs(paise % 100);
  return rest === 0 ? String(r) : `${r}.${String(rest).padStart(2, "0")}`;
}

export interface BookingForEdit {
  resort_id: string;
  guest_id: string;
  guest_name: string;
  guest_mobile: string;
  stay_type_id: number;
  booking_date: string;
  check_in_at: string;
  check_out_at: string;
  pax: number;
  co_category_id: number;
  co_entry_id: string | null;
  co_name: string | null;
  co_mode: string;
  pricing_method: PricingMethod;
  tariff_per_person_paise: number;
  extra_charges_paise: number;
  extra_charges_note: string | null;
  discount_paise: number;
  manual_adjustment_paise: number;
  manual_adjustment_reason: string | null;
  final_amount_paise: number | null;
  remarks: string | null;
}

/** The form filled with what the booking has now. The plan starts empty: new rows are only needed when the amount changes. */
export function valuesFromBooking(
  b: BookingForEdit,
  guestEmail: string | null,
): BookingFormValues {
  const inn = splitIst(b.check_in_at);
  const out = splitIst(b.check_out_at);
  const adjusted = b.manual_adjustment_paise !== 0;
  return {
    resortId: b.resort_id,
    guestId: b.guest_id,
    guestName: b.guest_name,
    guestMobile: b.guest_mobile,
    guestEmail: guestEmail ?? "",
    stayTypeId: String(b.stay_type_id),
    bookingDate: b.booking_date,
    checkInDate: inn.date,
    checkInTime: inn.time,
    checkOutDate: out.date,
    checkOutTime: out.time,
    pax: String(b.pax),
    coCategoryId: String(b.co_category_id),
    coEntryId: b.co_entry_id,
    coName: b.co_mode === "typed" ? (b.co_name ?? "") : "",
    pricingMethod: b.pricing_method,
    tariff: paiseText(b.tariff_per_person_paise),
    extra: b.extra_charges_paise === 0 ? "" : paiseText(b.extra_charges_paise),
    extraNote: b.extra_charges_note ?? "",
    discount: b.discount_paise === 0 ? "" : paiseText(b.discount_paise),
    changeFinal: adjusted,
    finalOverride:
      adjusted && b.final_amount_paise !== null
        ? paiseText(b.final_amount_paise)
        : "",
    adjustmentReason: b.manual_adjustment_reason ?? "",
    plan: [],
    remarks: b.remarks ?? "",
    changeReason: "",
  };
}
