/**
 * What a person may do with a payment or a refund, by its status (PRD FR-APR, FR-PAY-7, Q8, Q9a, D5). Pure and
 * unit-tested. These decide which BUTTONS the screen shows; the database decides what is actually allowed and refuses
 * the rest, whatever the screen shows.
 *
 *   waiting   -> may be edited (with a reason), may get more files, may be approved or rejected
 *   approved  -> locked; may be reversed (with a reason); may get a CORRECTION file (reason of 10+ letters); originals stay
 *   rejected / reversed -> final; nothing can be done; they never count anywhere
 * Approving your own entry is allowed (Q8): it is marked "Self-approved" and the screen says so first.
 */
export type Status = "waiting" | "approved" | "rejected" | "reversed";
export type Kind = "payment" | "refund";

export interface ItemAbilities {
  approve: boolean;
  reject: boolean;
  reverse: boolean;
  edit: boolean;
  addFiles: boolean;
  hideFile: boolean;
  correction: boolean;
  /** the orange note shown before approving your own entry */
  selfNote: string | null;
}

export function abilities(o: {
  status: Status;
  recordedBy: string | null;
  me: string;
}): ItemAbilities {
  const waiting = o.status === "waiting";
  const approved = o.status === "approved";
  return {
    approve: waiting,
    reject: waiting,
    reverse: approved,
    edit: waiting,
    addFiles: waiting,
    hideFile: waiting,
    correction: approved,
    selfNote:
      waiting && o.recordedBy !== null && o.recordedBy === o.me
        ? "You recorded this. It will be marked Self-approved."
        : null,
  };
}

/** The shortest reasons the database accepts (REASON_REQUIRED): ordinary 5 letters, correction files 10. */
export const MIN_REASON = 5;
export const MIN_CORRECTION_REASON = 10;

export const STATUS_WORDS: Record<Status, string> = {
  waiting: "Waiting for Approval",
  approved: "Approved",
  rejected: "Rejected",
  reversed: "Reversed",
};

export const isStatus = (v: unknown): v is Status =>
  v === "waiting" || v === "approved" || v === "rejected" || v === "reversed";

/** What a reason box must hold before the button works. */
export function reasonProblem(
  reason: string,
  min: number = MIN_REASON,
): string | null {
  return reason.trim().length >= min
    ? null
    : `Please write the reason (at least ${min} letters).`;
}

/**
 * D5: a payment cannot be reversed while refunds that depend on it are not settled. The database enforces it; this
 * only words the message the screen shows when the database refuses.
 */
export const REVERSAL_BLOCKED_TEXT =
  "This payment cannot be reversed because refunds depend on it. Reject or reverse the refunds first.";
