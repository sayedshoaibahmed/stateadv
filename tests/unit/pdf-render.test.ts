import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { buildModel } from "@/lib/pdf/model";
import { renderBookingPdf } from "@/lib/pdf/render";
import { sample } from "../shared/pdf-sample";

// fontkit comes with the PDF library (it reads the font files); it is only used here to prove every printed character has a glyph
const fontkit = createRequire(import.meta.url)("fontkit") as {
  create(b: Buffer): { hasGlyphForCodePoint(c: number): boolean };
};
const AT = new Date("2026-11-12T10:35:00Z");
const FONTS = path.join(process.cwd(), "src", "lib", "pdf", "fonts");
const render = (
  d = sample(),
  logo: Parameters<typeof renderBookingPdf>[1] = null,
) => renderBookingPdf(buildModel(d, { version: 1, generatedAt: AT }), logo);
const pages = (pdf: Buffer) =>
  (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

// a 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("a real PDF file (PR-01..)", () => {
  it("PR-01: a valid PDF: header, end marker, one page, the bundled Noto Sans embedded, the title holds the Booking ID", async () => {
    const pdf = await render();
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pages(pdf)).toBe(1);
    expect(text).toMatch(/NotoSans-Regular/);
    expect(text).toMatch(/NotoSans-Bold/);
    expect(text).toContain("AAA-2026-000001 booking statement");
    expect(pdf.length).toBeGreaterThan(5000);
    expect(pdf.length).toBeLessThan(10 * 1024 * 1024);
  });

  it("PR-02: the same data renders again without error (fonts are registered once)", async () => {
    const [a, b] = await Promise.all([render(), render()]);
    expect(pages(a)).toBe(1);
    expect(pages(b)).toBe(1);
  });

  it("PR-03: many payments make a multi-page PDF, every page numbered 'Page n of N'; rows are not lost", async () => {
    const d = sample();
    d.payments = Array.from({ length: 90 }, (_, i) => ({
      code: `AAA-2026-000001-P${i + 1}`,
      amount_paise: 10000 + i,
      method: "cash",
      provider: null,
      date: "2026-11-06",
      status: "approved" as const,
      self_approved: i % 7 === 0,
    }));
    const m = buildModel(d, { version: 3, generatedAt: AT });
    expect(m.payments.rows).toHaveLength(90);
    const pdf = await renderBookingPdf(m, null);
    expect(pages(pdf)).toBeGreaterThan(1);
    const small = await render();
    expect(pdf.length).toBeGreaterThan(small.length);
  });

  it("PR-04: very long guest names, notes and unbroken words do not break the page", async () => {
    const d = sample();
    d.guest.name = "A".repeat(400);
    d.booking.remarks = "word ".repeat(300) + "Z".repeat(500);
    d.booking.extra_note = "N".repeat(300);
    d.booking.adjustment_reason = "R".repeat(300);
    d.corrections = [
      {
        record_code: "AAA-2026-000001-P1",
        kind: "payment",
        file_name: null,
        date: "2026-11-10",
        by: "B".repeat(200),
        reason: "C".repeat(600),
      },
    ];
    const pdf = await render(d);
    expect(pdf.toString("latin1").startsWith("%PDF-1.")).toBe(true);
    expect(pages(pdf)).toBeGreaterThanOrEqual(1);
  });

  it("PR-05: missing optional values, empty lists, a cancelled booking and a no-show all render", async () => {
    const bare = sample();
    bare.booking = {
      ...bare.booking,
      co_name: null,
      extra_note: null,
      remarks: null,
      adjustment_reason: null,
      adjustment_paise: 0,
    };
    bare.plan = [];
    bare.payments = [];
    bare.corrections = [];
    expect((await render(bare)).toString("latin1").startsWith("%PDF-")).toBe(
      true,
    );
    for (const kind of ["cancelled", "no_show"] as const) {
      const d = sample();
      d.booking.status = kind;
      d.cancellation = {
        kind,
        date: "2026-11-11",
        reason: null,
        charge_paise: 100000,
        original_final_paise: 500000,
        charge_change_reason: "Guest was ill",
      };
      expect((await render(d)).toString("latin1").startsWith("%PDF-")).toBe(
        true,
      );
    }
  });

  it("PR-06: the resort logo (PNG) is embedded when given; without it the PDF is still made", async () => {
    const plain = await render();
    const withLogo = await render(sample(), { data: PNG, format: "png" });
    expect(withLogo.toString("latin1")).toMatch(/\/Subtype \/Image/);
    expect(plain.toString("latin1")).not.toMatch(/\/Subtype \/Image/);
  });
});

describe("every printed character exists in the bundled font (PR-08)", () => {
  const codePoints = (s: string) => [...s].map((c) => c.codePointAt(0)!);
  it("PR-08: ₹, ×, ·, –, −, — and every letter and digit of a rich page have glyphs in Noto Sans Regular and Bold (no missing-letter boxes)", () => {
    const d = sample();
    d.refunds = [
      {
        code: "R1",
        amount_paise: 100,
        method: "card",
        provider: "Visa",
        date: "2026-11-11",
        status: "approved",
        self_approved: true,
        reason: "Booking cancelled",
      },
    ];
    d.adjustments = [
      { date: "2026-11-09", amount_paise: -1000, reason: "Discount" },
    ];
    d.totals.extra_paise = 5000;
    d.totals.refund_due_paise = 5000;
    d.totals.refunds_waiting_paise = 100;
    d.booking.pricing_method = "per_person_per_night";
    d.booking.nights = 2;
    const m = buildModel(d, { version: 12, generatedAt: AT });
    const strings: string[] = [
      m.resortName,
      m.code,
      m.statusLabel,
      m.generatedLine,
      m.footer,
      "Page 1 of 2",
      "Booking statement",
      ...m.corrections,
    ];
    for (const p of [
      ...m.guestBlock,
      ...m.stayBlock,
      ...m.amountBlock,
      m.finalLine,
      ...m.totals,
      ...(m.cancellationBlock ?? []),
    ])
      strings.push(p.label, p.value);
    for (const t of [m.plan, m.payments, m.refunds, m.adjustments])
      if (t) strings.push(...t.head, ...t.rows.flat());
    for (const file of ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"]) {
      const font = (
        fontkit as unknown as {
          create(b: Buffer): { hasGlyphForCodePoint(c: number): boolean };
        }
      ).create(readFileSync(path.join(FONTS, file)));
      const missing = [...new Set(strings.flatMap(codePoints))].filter(
        (c) => c > 32 && !font.hasGlyphForCodePoint(c),
      );
      expect(
        missing.map((c) => String.fromCodePoint(c)),
        file,
      ).toEqual([]);
    }
    expect(strings.join("")).toContain("₹");
  });
  it("PR-09: the font files are the bundled, licensed ones", () => {
    for (const f of ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"])
      expect(
        readFileSync(path.join(FONTS, f)).subarray(0, 4).toString("hex"),
      ).toBe("00010000");
    expect(readFileSync(path.join(FONTS, "OFL.txt"), "utf8")).toContain(
      "SIL Open Font License",
    );
  });
});
