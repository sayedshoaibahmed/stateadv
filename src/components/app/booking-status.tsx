import { Ban, CircleDot, LogIn, LogOut, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type BookingStatus } from "@/lib/bookings/list";

const LOOK: Record<BookingStatus, { icon: typeof CircleDot; tone: string }> = {
  confirmed: { icon: CircleDot, tone: "bg-pending-soft text-pending" },
  checked_in: { icon: LogIn, tone: "bg-approved-soft text-approved" },
  checked_out: { icon: LogOut, tone: "bg-adjusted-soft text-adjusted" },
  cancelled: { icon: Ban, tone: "bg-rejected-soft text-rejected" },
  no_show: { icon: UserX, tone: "bg-waiting-soft text-waiting" },
};

/** The status of a BOOKING: an icon, a word and a colour (never the colour alone). */
export function BookingStatusBadge({
  status,
  className,
}: {
  status: BookingStatus;
  className?: string;
}) {
  const { icon: Icon, tone } = LOOK[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium whitespace-nowrap",
        tone,
        className,
      )}
      data-booking-status={status}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
