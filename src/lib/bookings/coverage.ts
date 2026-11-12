/**
 * The Payment Plan tab: for each plan row, how much of it is covered by money received and how much is still
 * outstanding (UI spec 3.5). Money received is spread over the rows in order of due date (oldest first), which is the
 * same idea the database uses for "overdue" (everything due so far, less what has been collected so far).
 * Pure and unit-tested. Only Approved payments less Approved refunds count (D1).
 */
export interface PlanLine {
  id: string;
  label: string;
  dueDate: string;
  amountPaise: number;
}

export interface CoveredLine extends PlanLine {
  coveredPaise: number;
  outstandingPaise: number;
  /** due before today and not fully covered */
  overdue: boolean;
  locked: boolean;
}

export function allocateCoverage(
  lines: readonly PlanLine[],
  netCollectedPaise: number,
  today: string,
): CoveredLine[] {
  let left = Math.max(netCollectedPaise, 0);
  return [...lines]
    .sort((a, b) =>
      a.dueDate === b.dueDate
        ? a.label.localeCompare(b.label)
        : a.dueDate < b.dueDate
          ? -1
          : 1,
    )
    .map((l) => {
      const covered = Math.min(left, l.amountPaise);
      left -= covered;
      const outstanding = l.amountPaise - covered;
      return {
        ...l,
        coveredPaise: covered,
        outstandingPaise: outstanding,
        overdue: l.dueDate < today && outstanding > 0,
        locked: l.dueDate < today,
      };
    });
}
