import { Check, Clock, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ApprovalStatus = "approved" | "waiting" | "rejected" | "reversed";

const LOOK: Record<
  ApprovalStatus,
  { label: string; icon: typeof Check; tone: string }
> = {
  approved: {
    label: "Approved",
    icon: Check,
    tone: "bg-approved-soft text-approved",
  },
  waiting: {
    label: "Waiting for Approval",
    icon: Clock,
    tone: "bg-waiting-soft text-waiting",
  },
  rejected: {
    label: "Rejected",
    icon: X,
    tone: "bg-rejected-soft text-rejected",
  },
  reversed: {
    label: "Reversed",
    icon: Undo2,
    tone: "bg-reversed-soft text-reversed",
  },
};

/** The status of a payment or refund: an icon, a word and a colour (never the colour alone). */
export function StatusBadge({
  status,
  className,
}: {
  status: ApprovalStatus;
  className?: string;
}) {
  const { label, icon: Icon, tone } = LOOK[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium whitespace-nowrap",
        tone,
        className,
      )}
      data-status={status}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Approved by the same person who entered it (Q8). Always small and orange. */
export function SelfApprovedTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-self-soft px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-self",
        className,
      )}
    >
      Self-approved
    </span>
  );
}

/** A figure that was adjusted by hand. Small and grey. */
export function AdjustedTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-adjusted-soft px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-adjusted",
        className,
      )}
    >
      Adjusted
    </span>
  );
}

/**
 * A payment or refund whose date was written as an earlier day than the day it was typed in (backdating is allowed;
 * FR-CAL-3). Both dates are given so the reason for the tag is never a mystery. Small and grey.
 */
export function BackdatedTag({
  entered,
  className,
}: {
  entered?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-adjusted-soft px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-adjusted",
        className,
      )}
      title={entered ? `Entered on ${entered}` : "Entered on a later day"}
    >
      Backdated
    </span>
  );
}
