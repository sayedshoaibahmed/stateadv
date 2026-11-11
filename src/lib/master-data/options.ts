/**
 * "Type to search" for the lists Managers configure (C/O categories and names, resorts, stay types).
 * Pure functions, so the rules are tested without a browser. The booking forms and the settings screens both use them.
 *
 * Rules:
 *  - a NEW choice can only be a switched-on option (owner requirement 2026-11-11);
 *  - an old booking that already uses a switched-off option still SHOWS it (it is the "selected" one) but the option
 *    is not offered for any other booking;
 *  - search ignores capitals, extra spaces and accents, and puts names that START with the typing first.
 */

export interface Option {
  id: string | number;
  label: string;
  active: boolean;
  /** extra text that is also searched and shown in small print (a phone number, a location ...) */
  hint?: string;
  sortOrder?: number;
}

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export interface FilterOptions {
  /** the option the record already has (shown even if switched off) */
  selectedId?: string | number | null;
  /** settings screens list everything, booking forms only offer switched-on options */
  includeInactive?: boolean;
  limit?: number;
}

export function filterOptions(
  options: readonly Option[],
  query: string,
  {
    selectedId = null,
    includeInactive = false,
    limit = 50,
  }: FilterOptions = {},
): Option[] {
  const q = fold(query);
  const visible = options.filter(
    (o) =>
      includeInactive ||
      o.active ||
      (selectedId !== null && o.id === selectedId),
  );
  const scored = visible
    .map((o) => {
      const label = fold(o.label);
      const hint = o.hint ? fold(o.hint) : "";
      let rank: number | null;
      if (q === "") rank = 2;
      else if (label.startsWith(q)) rank = 0;
      else if (label.split(" ").some((w) => w.startsWith(q))) rank = 1;
      else if (label.includes(q) || hint.includes(q)) rank = 2;
      else rank = null;
      return { o, rank };
    })
    .filter((x): x is { o: Option; rank: number } => x.rank !== null);
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.o.sortOrder ?? 100) - (b.o.sortOrder ?? 100) ||
      a.o.label.localeCompare(b.o.label, "en", { sensitivity: "base" }),
  );
  return scored.slice(0, limit).map((x) => x.o);
}

/** Can this option be chosen for a NEW or CHANGED selection? */
export function isSelectable(
  o: Option,
  currentId: string | number | null,
): boolean {
  return o.active || (currentId !== null && o.id === currentId);
}
