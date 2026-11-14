import { describe, expect, it } from "vitest";
import {
  BASES,
  BASIS_LABELS,
  BASIS_SHORT,
  isBookingDate,
  PAGE_SIZE,
  TYPES,
  activeFilterCount,
  pageCount,
  parseRecordFilter,
  recordHref,
  recordsHref,
  searchArgs,
} from "@/lib/records/filters";
import {
  ACTIONS,
  RECORD_TYPES,
  activeFilterCount as activityCount,
  activityHref,
  listArgs,
  pageCount as activityPages,
  parseActivityFilter,
} from "@/lib/activity/filters";
import {
  describeEntry,
  diffRows,
  fieldLabel,
  formatValue,
  isHiddenField,
  thingWord,
  type ActivityEntry,
} from "@/lib/activity/diff";

const RESORT = "11111111-2222-4333-8444-555555555555";
const USER = "99999999-2222-4333-8444-555555555555";

describe("Old Records filters (RECF-01..)", () => {
  it("RECF-01: no address = everything, newest first, page 1", () => {
    const f = parseRecordFilter({});
    expect(f).toEqual({
      q: "",
      resort: null,
      types: [],
      basis: "record",
      from: null,
      to: null,
      page: 1,
      problem: null,
    });
    expect(activeFilterCount(f)).toBe(0);
    expect(recordsHref(f)).toBe("/old-records");
    const a = searchArgs(f);
    expect(a).toMatchObject({
      p_basis: "record",
      p_limit: PAGE_SIZE,
      p_offset: 0,
    });
    expect(a.p_q).toBeUndefined();
    expect(a.p_types).toBeUndefined();
  });
  it("RECF-02: a full address is read, cleaned and turned into the database arguments", () => {
    const f = parseRecordFilter({
      q: "  Asha   RAO  ",
      resort: RESORT,
      types: ["payment", "booking", "payment"],
      basis: "entry",
      from: "2026-03-01",
      to: "2026-03-31",
      page: "3",
    });
    expect(f.q).toBe("Asha RAO");
    expect(f.types).toEqual(["booking", "payment"]); // fixed order, no repeats
    expect(searchArgs(f)).toEqual({
      p_q: "Asha RAO",
      p_resort: RESORT,
      p_types: ["booking", "payment"],
      p_basis: "entry",
      p_from: "2026-03-01",
      p_to: "2026-03-31",
      p_limit: PAGE_SIZE,
      p_offset: 2 * PAGE_SIZE,
    });
    expect(activeFilterCount(f)).toBe(4);
    expect(recordsHref(f)).toBe(
      `/old-records?q=Asha+RAO&resort=${RESORT}&types=booking&types=payment&basis=entry&from=2026-03-01&to=2026-03-31&page=3`,
    );
    expect(parseRecordFilter(Object.fromEntries([["q", "x"]]))).toBeTruthy();
  });
  it("RECF-03: bad values are ignored with a plain note, never an error", () => {
    const bad = parseRecordFilter({
      resort: "nope",
      types: ["guest"],
      basis: "weird",
      from: "2026-02-30",
      to: "2026-03-01",
      page: "-4",
    });
    expect(bad.resort).toBeNull();
    expect(bad.types).toEqual([]);
    expect(bad.basis).toBe("record");
    expect(bad.from).toBeNull();
    expect(bad.to).toBeNull();
    expect(bad.page).toBe(1);
    expect(bad.problem).toBeTruthy();
    expect(
      parseRecordFilter({ from: "2026-03-10", to: "2026-03-01" }).problem,
    ).toMatch(/end date/);
    expect(parseRecordFilter({ page: "99999999" }).page).toBe(1);
  });
  it("RECF-03b: the five stored dates (FR-CAL-3) are read from the address; the three booking dates are named so; a wrong one falls back with a note", () => {
    for (const b of [
      "record",
      "entry",
      "check_in",
      "check_out",
      "cancellation",
    ]) {
      const f = parseRecordFilter({ basis: b, from: "2026-03-01" });
      expect(f.basis).toBe(b);
      expect(f.problem).toBeNull();
      expect(searchArgs(f).p_basis).toBe(b);
      expect(recordsHref(f)).toBe(
        b === "record"
          ? "/old-records?from=2026-03-01"
          : `/old-records?basis=${b}&from=2026-03-01`,
      );
      expect(BASIS_LABELS[b as keyof typeof BASIS_LABELS]).toBeTruthy();
      expect(BASIS_SHORT[b as keyof typeof BASIS_SHORT]).toBeTruthy();
    }
    expect([...BASES]).toEqual([
      "record",
      "entry",
      "check_in",
      "check_out",
      "cancellation",
    ]);
    expect(BASES.filter(isBookingDate)).toEqual([
      "check_in",
      "check_out",
      "cancellation",
    ]);
    for (const bad of ["checkin", "stay", "CHECK_IN", "1"]) {
      const f = parseRecordFilter({ basis: bad });
      expect(f.basis).toBe("record");
      expect(f.problem).toMatch(/not known/);
    }
    expect(
      activeFilterCount(parseRecordFilter({ basis: "cancellation" })),
    ).toBe(1);
    expect(activeFilterCount(parseRecordFilter({ basis: "record" }))).toBe(0);
  });
  it("RECF-04: search text is cut at 100 letters; paging maths; each kind has its own page address", () => {
    expect(parseRecordFilter({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
    expect(recordHref("booking", "b1")).toBe("/bookings/b1");
    expect(recordHref("payment", "p1")).toBe("/payments/p1");
    expect(recordHref("refund", "r1")).toBe("/refunds/r1");
    expect(TYPES).toEqual(["booking", "payment", "refund"]);
    expect(BASES).toEqual([
      "record",
      "entry",
      "check_in",
      "check_out",
      "cancellation",
    ]); // the three booking dates were added for FR-CAL-3
  });
});

describe("Activity filters (ACTF-01..)", () => {
  it("ACTF-01: no address = everything, newest first", () => {
    const f = parseActivityFilter({});
    expect(f).toMatchObject({
      actor: null,
      action: null,
      type: null,
      corrections: false,
      page: 1,
      problem: null,
    });
    expect(activityCount(f)).toBe(0);
    expect(activityHref(f)).toBe("/activity");
    expect(listArgs(f)).toEqual({
      p_actor: undefined,
      p_action: undefined,
      p_record_type: undefined,
      p_resort: undefined,
      p_booking: undefined,
      p_from: undefined,
      p_to: undefined,
      p_corrections: undefined,
      p_limit: PAGE_SIZE,
      p_offset: 0,
    });
  });
  it("ACTF-02: a full address is read and turned into the database arguments and back into an address", () => {
    const f = parseActivityFilter({
      actor: USER,
      action: "update",
      type: "payment",
      resort: RESORT,
      from: "2026-03-01",
      to: "2026-03-31",
      corrections: "1",
      page: "2",
    });
    expect(listArgs(f)).toEqual({
      p_actor: USER,
      p_action: "update",
      p_record_type: "payment",
      p_resort: RESORT,
      p_booking: undefined,
      p_from: "2026-03-01",
      p_to: "2026-03-31",
      p_corrections: true,
      p_limit: PAGE_SIZE,
      p_offset: PAGE_SIZE,
    });
    expect(activityCount(f)).toBe(6);
    expect(
      parseActivityFilter(
        Object.fromEntries(new URL(`http://x${activityHref(f)}`).searchParams),
      ),
    ).toEqual(f);
  });
  it("ACTF-03: bad values are ignored with a note", () => {
    const f = parseActivityFilter({
      actor: "me",
      action: "delete",
      type: "everything",
      resort: "x",
      booking: "y",
      from: "bad",
    });
    expect(f).toMatchObject({
      actor: null,
      action: null,
      type: null,
      resort: null,
      booking: null,
      from: null,
      to: null,
    });
    expect(f.problem).toBeTruthy();
    expect(ACTIONS).toEqual(["insert", "update", "account"]);
    expect(RECORD_TYPES).toContain("file");
    expect(activityPages(51)).toBe(3);
  });
});

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: 1,
  at: "2026-11-12T10:35:00Z",
  actorName: "Asha Rao",
  action: "update",
  recordType: "payment",
  tableName: "payments",
  recordId: "p1",
  recordCode: "AAA-2026-000001-P1",
  bookingId: "b1",
  bookingCode: "AAA-2026-000001",
  resortId: RESORT,
  targetUserName: null,
  changedFields: null,
  oldValues: null,
  newValues: null,
  reason: null,
  ...over,
});

describe("Activity wording and diffs (ACTD-01..)", () => {
  it("ACTD-01: money shows as rupees, dates and times in India time, true/false as Yes/No, statuses in words", () => {
    expect(formatValue("amount_paise", 150000)).toBe("₹1,500");
    expect(formatValue("final_amount_paise", 1234567)).toBe("₹12,345.67");
    expect(formatValue("status", "waiting")).toBe("Waiting for Approval");
    expect(formatValue("status", "checked_in")).toBe("Checked-in");
    expect(formatValue("method", "upi")).toBe("UPI");
    expect(formatValue("payment_date", "2026-03-11")).toBe("11 Mar 2026");
    expect(formatValue("approved_at", "2026-03-31T18:30:00+00:00")).toBe(
      "1 Apr 2026, 12:00 AM",
    ); // 00:00 IST next day
    expect(formatValue("is_correction", true)).toBe("Yes");
    expect(formatValue("remarks", null)).toBe("—");
    expect(formatValue("remarks", "")).toBe("—");
    expect(formatValue("remarks", "Late arrival")).toBe("Late arrival");
    expect(formatValue("nights", 2)).toBe("2");
  });
  it("ACTD-02: field names are plain English; an unknown one is made readable", () => {
    expect(fieldLabel("guest_mobile")).toBe("Mobile number");
    expect(fieldLabel("tariff_per_person_paise")).toBe("Rate per person");
    expect(fieldLabel("some_new_field_paise")).toBe("Some new field");
    expect(fieldLabel("odd")).toBe("Odd");
  });
  it("ACTD-03: unreadable internals are hidden: ids, who-did-it ids, versions, keys, long identifiers", () => {
    for (const k of [
      "id",
      "resort_id",
      "booking_id",
      "approved_by",
      "version",
      "created_at",
      "updated_at",
      "storage_path",
      "sha256",
      "idempotency_key",
      "booking_code",
    ])
      expect(isHiddenField(k, "x")).toBe(true);
    expect(
      isHiddenField("remarks", "11111111-2222-4333-8444-555555555555"),
    ).toBe(true);
    expect(isHiddenField("remarks", "Late arrival")).toBe(false);
    expect(isHiddenField("amount_paise", 100)).toBe(false);
  });
  it("ACTD-04: a change shows only what changed, before and after, in plain words", () => {
    const rows = diffRows(
      entry({
        changedFields: [
          "status",
          "approved_at",
          "approved_by",
          "amount_paise",
          "version",
        ],
        oldValues: {
          status: "waiting",
          approved_at: null,
          approved_by: null,
          amount_paise: 100000,
          version: 1,
        },
        newValues: {
          status: "approved",
          approved_at: "2026-03-10T08:30:00Z",
          approved_by: USER,
          amount_paise: 150000,
          version: 2,
        },
      }),
    );
    expect(rows.map((r) => [r.label, r.before, r.after])).toEqual([
      ["Status", "Waiting for Approval", "Approved"],
      ["Approved on", "—", "10 Mar 2026, 2:00 PM"],
      ["Amount", "₹1,000", "₹1,500"],
    ]);
  });
  it("ACTD-05: a new record lists what was filled in (empty and unreadable fields left out, at most 14)", () => {
    const newValues: Record<string, unknown> = {
      id: "x",
      guest_name: "Asha Rao",
      remarks: null,
      pax: 2,
      final_amount_paise: 500000,
      resort_id: RESORT,
    };
    for (let i = 0; i < 30; i++) newValues[`extra_${i}`] = `v${i}`;
    const rows = diffRows(
      entry({ action: "insert", recordType: "booking", newValues }),
    );
    expect(rows.length).toBe(14);
    expect(rows[0]).toEqual({
      key: "guest_name",
      label: "Guest name",
      before: "—",
      after: "Asha Rao",
    });
    expect(rows.map((r) => r.key)).not.toContain("remarks");
    expect(rows.map((r) => r.key)).not.toContain("id");
    expect(rows.map((r) => r.key)).not.toContain("resort_id");
    expect(diffRows(entry({ action: "password_reset" }))).toEqual([]);
  });
  it("ACTD-06: one sentence per entry, with the right verb", () => {
    expect(
      describeEntry(
        entry({ changedFields: ["status"], newValues: { status: "approved" } }),
      ),
    ).toBe("Asha Rao approved a payment.");
    expect(
      describeEntry(
        entry({
          recordType: "refund",
          changedFields: ["status"],
          newValues: { status: "rejected" },
        }),
      ),
    ).toBe("Asha Rao rejected a refund.");
    expect(
      describeEntry(
        entry({ changedFields: ["status"], newValues: { status: "reversed" } }),
      ),
    ).toBe("Asha Rao reversed a payment.");
    expect(
      describeEntry(entry({ action: "insert", recordType: "booking" })),
    ).toBe("Asha Rao added a booking.");
    expect(
      describeEntry(
        entry({
          action: "insert",
          recordType: "file",
          newValues: { is_correction: true },
        }),
      ),
    ).toBe("Asha Rao added a file after approval.");
    expect(
      describeEntry(
        entry({
          action: "insert",
          recordType: "file",
          newValues: { is_correction: false },
        }),
      ),
    ).toBe("Asha Rao added a file.");
    expect(
      describeEntry(
        entry({
          recordType: "booking",
          changedFields: ["status"],
          newValues: { status: "cancelled" },
        }),
      ),
    ).toBe("Asha Rao cancelled a booking.");
    expect(
      describeEntry(
        entry({
          recordType: "booking",
          changedFields: ["status"],
          newValues: { status: "no_show" },
        }),
      ),
    ).toBe("Asha Rao marked a booking as a no-show.");
    expect(
      describeEntry(
        entry({
          recordType: "booking",
          changedFields: ["status"],
          newValues: { status: "checked_in" },
        }),
      ),
    ).toBe("Asha Rao changed a booking to Checked-in.");
    expect(
      describeEntry(
        entry({
          recordType: "booking",
          changedFields: ["remarks"],
          newValues: { remarks: "x" },
        }),
      ),
    ).toBe("Asha Rao changed a booking.");
    expect(
      describeEntry(
        entry({ recordType: "plan", changedFields: ["amount_paise"] }),
      ),
    ).toBe("Asha Rao changed a payment plan.");
    expect(
      describeEntry(
        entry({ actorName: null, action: "insert", recordType: "guest" }),
      ),
    ).toBe("The system added a guest.");
  });
  it("ACTD-07: account actions in plain words, with the person they were about", () => {
    expect(
      describeEntry(
        entry({
          action: "password_reset",
          recordType: "user",
          targetUserName: "Ravi",
        }),
      ),
    ).toBe("Asha Rao set a new temporary password for Ravi.");
    expect(
      describeEntry(
        entry({
          action: "owner_recovered",
          recordType: "user",
          targetUserName: "Ravi",
        }),
      ),
    ).toBe("Asha Rao recovered the Owner account of Ravi.");
    expect(
      describeEntry(
        entry({
          action: "update",
          recordType: "user",
          targetUserName: "Ravi",
          changedFields: ["is_active"],
          newValues: { is_active: false },
        }),
      ),
    ).toBe("Asha Rao switched off the account of Ravi.");
    expect(
      describeEntry(
        entry({
          action: "update",
          recordType: "user",
          targetUserName: "Ravi",
          changedFields: ["is_active"],
          newValues: { is_active: true },
        }),
      ),
    ).toBe("Asha Rao switched on the account of Ravi.");
    expect(
      describeEntry(entry({ action: "reauth_verified", recordType: "user" })),
    ).toMatch(/type their password again/);
    expect(
      describeEntry(
        entry({
          action: "something_new",
          recordType: "user",
          targetUserName: null,
        }),
      ),
    ).toBe("Asha Rao did an account action (something new) for a person.");
    expect(thingWord("pdf")).toBe("PDF");
    expect(thingWord("unknown")).toBe("record");
  });
});
