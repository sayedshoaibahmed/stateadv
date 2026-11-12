import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";

/** What a figure means. Each meaning has ONE colour everywhere (UI spec section 1, point 4). */
export type MoneyTone =
  | "neutral"
  | "approved"
  | "waiting"
  | "rejected"
  | "reversed"
  | "pending"
  | "extra"
  | "refund";

const TONE: Record<MoneyTone, string> = {
  neutral: "",
  approved: "text-approved",
  waiting: "text-waiting",
  rejected: "text-rejected",
  reversed: "text-reversed line-through",
  pending: "text-pending",
  extra: "text-extra",
  refund: "text-refund",
};

/**
 * An amount of money, always formatted the Indian way (₹1,50,000), numbers lined up (tabular), never wrapped.
 * A refund is shown with a "−" sign; a reversed amount is struck through and says so to screen readers.
 * `paise` is a whole number of paise.
 */
export function Money({
  paise,
  tone = "neutral",
  className,
}: {
  paise: number;
  tone?: MoneyTone;
  className?: string;
}) {
  const text =
    tone === "refund" && paise > 0
      ? `−${formatPaise(paise)}`
      : formatPaise(paise);
  return (
    <span
      className={cn("whitespace-nowrap tabular-nums", TONE[tone], className)}
      data-tone={tone}
    >
      {text}
      {tone === "reversed" ? (
        <span className="sr-only"> (reversed, not counted)</span>
      ) : null}
      {tone === "refund" && paise > 0 ? (
        <span className="sr-only"> (refund)</span>
      ) : null}
    </span>
  );
}
