import { describe, expect, it } from "vitest";
import {
  filterOptions,
  isSelectable,
  type Option,
} from "@/lib/master-data/options";
import {
  coCategorySchema,
  coEntrySchema,
  formToObject,
  resortSchema,
  stayTypeSchema,
} from "@/lib/settings/schemas";
import { fieldErrors } from "@/lib/auth/schemas";

const opts: Option[] = [
  { id: 1, label: "Acme Travel", active: true },
  { id: 2, label: "Beach Holidays", active: true, hint: "+91 99999 11111" },
  { id: 3, label: "Old Agency", active: false },
  { id: 4, label: "Café Tours", active: true },
  { id: 5, label: "Travel Bees", active: true },
  { id: 6, label: "Zed Travel", active: true, sortOrder: 5 },
];

describe("type-to-search in booking forms", () => {
  it("MDS-01: only switched-on options are offered for a new choice", () => {
    expect(filterOptions(opts, "").map((o) => o.id)).not.toContain(3);
    expect(filterOptions(opts, "old")).toEqual([]);
  });
  it("MDS-02: an old booking still SHOWS its switched-off choice, but it is not offered to others", () => {
    expect(
      filterOptions(opts, "old", { selectedId: 3 }).map((o) => o.id),
    ).toEqual([3]);
    expect(filterOptions(opts, "old", { selectedId: 1 })).toEqual([]);
    expect(isSelectable(opts[2], 3)).toBe(true);
    expect(isSelectable(opts[2], 1)).toBe(false);
    expect(isSelectable(opts[2], null)).toBe(false);
  });
  it("MDS-03: settings screens list everything, including switched-off options", () => {
    expect(filterOptions(opts, "", { includeInactive: true })).toHaveLength(6);
  });
  it("MDS-04: search ignores capitals, spaces and accents; also finds the small-print hint", () => {
    expect(filterOptions(opts, "  ACME  ").map((o) => o.id)).toEqual([1]);
    expect(filterOptions(opts, "cafe").map((o) => o.id)).toEqual([4]);
    expect(filterOptions(opts, "99999").map((o) => o.id)).toEqual([2]);
    expect(filterOptions(opts, "zzz")).toEqual([]);
  });
  it("MDS-05: names that START with the typing come first, then word starts, then anywhere", () => {
    expect(filterOptions(opts, "travel").map((o) => o.label)).toEqual([
      "Travel Bees",
      "Zed Travel",
      "Acme Travel",
    ]);
  });
  it("MDS-06: the configured sort order is used, then the alphabet; the list can be limited", () => {
    const all = filterOptions(opts, "").map((o) => o.label);
    expect(all[0]).toBe("Zed Travel"); // sortOrder 5 beats the default 100
    expect(all.slice(1)).toEqual(
      [...all.slice(1)].sort((a, b) =>
        a.localeCompare(b, "en", { sensitivity: "base" }),
      ),
    );
    expect(filterOptions(opts, "", { limit: 2 })).toHaveLength(2);
  });
});

describe("settings forms", () => {
  it("MDS-07: a category needs a name and a kind; the checkbox means 'switched on'", () => {
    const ok = coCategorySchema.parse(
      formToObject(
        fd({ name: " Corporate ", name_mode: "listed", active: "on" }),
      ),
    );
    expect(ok).toMatchObject({
      name: "Corporate",
      name_mode: "listed",
      active: true,
    });
    expect(
      coCategorySchema.parse(formToObject(fd({ name: "X", name_mode: "none" })))
        .active,
    ).toBe(false);
    for (const bad of [
      { name: "", name_mode: "listed" },
      { name: "x".repeat(61), name_mode: "listed" },
      { name: "X", name_mode: "sometimes" },
      { name: "X" },
    ]) {
      expect(coCategorySchema.safeParse(bad).success).toBe(false);
    }
    const r = coCategorySchema.safeParse({ name: "", name_mode: "listed" });
    if (!r.success)
      expect(fieldErrors(r.error).name).toBe("Please enter the category name.");
  });
  it("MDS-08: a name in a list needs a category; a phone and notes are optional", () => {
    const ok = coEntrySchema.parse({
      category_id: "3",
      name: " Acme Ltd ",
      mobile: "",
      notes: "",
    });
    expect(ok).toMatchObject({
      category_id: 3,
      name: "Acme Ltd",
      mobile: undefined,
    });
    expect(coEntrySchema.safeParse({ name: "Acme" }).success).toBe(false);
    expect(
      coEntrySchema.safeParse({ category_id: "3", name: " " }).success,
    ).toBe(false);
  });
  it("MDS-09: resort code is made upper-case and must be 2-10 letters or numbers", () => {
    expect(resortSchema.parse({ code: " ab1 ", name: "Test" }).code).toBe(
      "AB1",
    );
    for (const code of ["A", "AB-1", "ABCDEFGHIJK", "", "A B"]) {
      expect(resortSchema.safeParse({ code, name: "Test" }).success, code).toBe(
        false,
      );
    }
    expect(resortSchema.safeParse({ code: "AB1", name: "" }).success).toBe(
      false,
    );
  });
  it("MDS-10: a stay type needs a name; an empty id means 'add'", () => {
    expect(stayTypeSchema.safeParse({ name: "Weekend" }).success).toBe(true);
    expect(stayTypeSchema.safeParse({ name: "" }).success).toBe(false);
    expect(formToObject(fd({ id: "", name: "x" }))).toEqual({ name: "x" });
  });
});

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
