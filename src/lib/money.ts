/**
 * Money helpers. ALL money is an integer number of PAISE (₹1 = 100 paise).
 *
 * Rules (TRD §3):
 *  - Never use floating-point arithmetic on money.
 *  - Parse user input from the STRING (never parseFloat × 100).
 *  - The database is the source of truth; these helpers are for input
 *    parsing, display and live previews only.
 */

export type Paise = number;

/** ₹10 lakh crore — far above any real amount, far below 2^53. */
export const MAX_PAISE: Paise = 1_000_000_000_000_000; // 1e15 paise = ₹1e13

export class MoneyError extends Error {
  constructor(
    public readonly code:
      | "EMPTY"
      | "INVALID_FORMAT"
      | "TOO_MANY_DECIMALS"
      | "NEGATIVE"
      | "TOO_LARGE"
      | "NOT_INTEGER_PAISE",
    message: string,
  ) {
    super(message);
    this.name = "MoneyError";
  }
}

const PLAIN = /^\d+(\.\d+)?$/;
const INTERNATIONAL = /^\d{1,3}(,\d{3})+(\.\d+)?$/; // 150,000.00
const INDIAN = /^\d{1,2}(,\d{2})*,\d{3}(\.\d+)?$/; // 1,50,000.00

/**
 * Parse a rupee amount typed by a user into integer paise.
 * Accepts "2500", "2,500.50", "1,50,000", "₹ 5,000", "0.5".
 * Rejects negatives, exponents, letters, more than 2 decimals, bad commas.
 */
export function parseRupeesToPaise(input: string): Paise {
  let s = (input ?? "").trim().replace(/^₹\s*/, "").replace(/\s+/g, "");
  if (s === "") throw new MoneyError("EMPTY", "Please enter an amount.");
  if (s.startsWith("-")) {
    throw new MoneyError("NEGATIVE", "Amount cannot be negative.");
  }
  if (s.startsWith(".")) s = "0" + s;

  const ok = PLAIN.test(s) || INTERNATIONAL.test(s) || INDIAN.test(s);
  if (!ok) {
    throw new MoneyError(
      "INVALID_FORMAT",
      "Please enter a valid amount, for example 2500 or 2,500.50.",
    );
  }

  const [intPartRaw, fracRaw = ""] = s.replace(/,/g, "").split(".");
  if (fracRaw.length > 2) {
    throw new MoneyError(
      "TOO_MANY_DECIMALS",
      "Amount can have at most 2 digits after the decimal point.",
    );
  }
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "");
  // 13 digits of rupees max (MAX_PAISE = ₹1e13) — check before Number().
  if (intPart.length > 13) {
    throw new MoneyError("TOO_LARGE", "Amount is too large.");
  }
  const paise = Number(intPart) * 100 + Number(fracRaw.padEnd(2, "0"));
  if (paise > MAX_PAISE) {
    throw new MoneyError("TOO_LARGE", "Amount is too large.");
  }
  return paise;
}

/** Throws unless `value` is a safe integer number of paise. */
export function assertPaise(value: number, label = "amount"): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(
      "NOT_INTEGER_PAISE",
      `${label} must be a whole number of paise.`,
    );
  }
  if (Math.abs(value) > MAX_PAISE) {
    throw new MoneyError("TOO_LARGE", `${label} is too large.`);
  }
  return value;
}

/** Integer multiplication with overflow protection (e.g. pax × tariff × nights). */
export function multiplyPaise(amount: Paise, ...factors: number[]): Paise {
  assertPaise(amount);
  let result = amount;
  for (const f of factors) {
    if (!Number.isSafeInteger(f) || f < 0) {
      throw new MoneyError(
        "NOT_INTEGER_PAISE",
        "Multiplier must be a whole number.",
      );
    }
    result *= f;
    assertPaise(result);
  }
  return result;
}

/** Sum of paise values (exact for safe integers). */
export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const v of values) total = assertPaise(total + assertPaise(v));
  return total;
}

const groupFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

/**
 * Format paise for display in Indian style: 15000000 → "₹1,50,000".
 * Shows paise only when present: 250050 → "₹2,500.50".
 * `alwaysShowPaise` forces ".00" (useful in reports/CSV-like views).
 */
export function formatPaise(
  paise: Paise,
  opts: { alwaysShowPaise?: boolean } = {},
): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100); // exact: abs is an integer
  const rest = abs - rupees * 100;
  const frac =
    rest !== 0 || opts.alwaysShowPaise
      ? "." + String(rest).padStart(2, "0")
      : "";
  return `${negative ? "−" : ""}₹${groupFormatter.format(rupees)}${frac}`;
}

/** Plain decimal string for CSV/export: 250050 → "2500.50", -5 → "-0.05". */
export function paiseToDecimalString(paise: Paise): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const rest = abs - rupees * 100;
  return `${negative ? "-" : ""}${rupees}.${String(rest).padStart(2, "0")}`;
}
