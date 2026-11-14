/**
 * The two shapes a screen needs from one read of the resorts: the choices for a "Resort" list (a switched-off resort is
 * still offered, marked "(closed)", because old records belong to it) and the id -> name map for the rows.
 * Pure; the read itself is `loadResorts` in lib/bookings/data.ts and runs as the signed-in user.
 */
export interface ResortInfo {
  id: string;
  name: string;
  active: boolean;
}

export function resortChoices(
  list: readonly ResortInfo[],
): { id: string; name: string }[] {
  return list.map((r) => ({
    id: r.id,
    name: r.active ? r.name : `${r.name} (closed)`,
  }));
}

export function resortNameMap(
  list: readonly ResortInfo[],
): Map<string, string> {
  return new Map(list.map((r) => [r.id, r.name]));
}
