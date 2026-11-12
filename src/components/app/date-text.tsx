import { formatDisplayDate, formatDisplayTime } from "@/lib/dates";

/** The words and machine value for a date, or null when it cannot be read. */
function describe(
  value: string | Date,
  withTime: boolean,
): { text: string; iso: string } | null {
  try {
    const plain =
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (plain) return { text: formatDisplayDate(value), iso: value };
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return null;
    const date = formatDisplayDate(instant);
    return {
      text: withTime ? `${date}, ${formatDisplayTime(instant)}` : date,
      iso: instant.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * A date the way people say it: "12 Nov 2026", with the time "4:05 PM" when asked. Always India time (IST), whatever
 * the computer's time zone is (UI spec section 6). Accepts a plain date ("2026-11-12") or a moment (Date or an ISO
 * time stamp from the database); anything unreadable shows a dash instead of breaking the page.
 */
export function DateText({
  value,
  withTime = false,
  className,
}: {
  value: string | Date | null | undefined;
  withTime?: boolean;
  className?: string;
}) {
  const d = value ? describe(value, withTime) : null;
  if (!d) return <span className={className}>—</span>;
  return (
    <time className={className} dateTime={d.iso}>
      {d.text}
    </time>
  );
}
