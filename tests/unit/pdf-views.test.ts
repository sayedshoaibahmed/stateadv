import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/pdf/actions", () => ({
  pdfDownloadAction: vi.fn(),
  regeneratePdfAction: vi.fn(),
}));

import { PdfTab, kb, pdfStatusText } from "@/components/app/pdf/pdf-tab";
import {
  DownloadPdfButton,
  RegeneratePdfButton,
} from "@/components/app/pdf/pdf-actions";
import type { BookingDetail } from "@/lib/bookings/data";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);
const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&");
const d = (over: Partial<BookingDetail> = {}) =>
  ({
    booking: { id: "b1" },
    pdfs: [],
    pdfJobs: [],
    ...over,
  }) as unknown as BookingDetail;
const v = (n: number, over: Record<string, unknown> = {}) => ({
  id: `ver${n}`,
  version_no: n,
  trigger_reason: "payment added",
  size_bytes: 20480,
  generated_at: "2026-11-12T10:35:00Z",
  ...over,
});

describe("the PDFs tab (PV6-01..)", () => {
  it("PV6-01: versions newest first, the current one marked, each with its date (IST), reason, size and its own Download button (FR-PDF-4, PDF-09)", () => {
    const out = html(
      h(PdfTab, {
        d: d({
          pdfs: [
            v(3, { trigger_reason: "payment approved" }),
            v(2),
            v(1, { trigger_reason: "booking created", size_bytes: 900 }),
          ] as never,
        }),
      }),
    );
    const t = text(out);
    expect(t.indexOf("Version 3")).toBeLessThan(t.indexOf("Version 2"));
    expect(t.indexOf("Version 2")).toBeLessThan(t.indexOf("Version 1"));
    expect(t.match(/Current/g)).toHaveLength(1);
    expect(t.indexOf("Current")).toBeLessThan(t.indexOf("Version 2"));
    for (const w of [
      "12 Nov 2026, 4:05 PM",
      "payment approved",
      "20 KB",
      "booking created",
      "900 B",
      "Download version 1",
      "Download version 2",
      "Download version 3",
    ])
      expect(t).toContain(w);
    expect(out).not.toMatch(/storage_path|booking-pdfs|supabase/i); // no storage address in the page
  });
  it("PV6-02: no version yet: a friendly empty state and the Regenerate button", () => {
    const t = text(html(h(PdfTab, { d: d() })));
    expect(t).toContain("No PDF yet");
    expect(t).toContain("Regenerate PDF");
  });
  it("PV6-03: the queue in plain words: being prepared, or failed with the saved reassurance (FR-PDF-6)", () => {
    expect(pdfStatusText([])).toBeNull();
    expect(
      pdfStatusText([{ status: "pending", lastError: null }]),
    ).toMatchObject({
      tone: "info",
      text: expect.stringContaining("being prepared"),
    });
    expect(pdfStatusText([{ status: "running", lastError: null }])?.tone).toBe(
      "info",
    );
    const f = pdfStatusText([
      { status: "pending", lastError: null },
      { status: "failed", lastError: "The PDF could not be made." },
    ]);
    expect(f?.tone).toBe("problem");
    expect(f?.text).toContain("The booking is saved");
    expect(f?.text).toContain("tried again automatically");
    const failedTab = html(
      h(PdfTab, { d: d({ pdfJobs: [{ status: "failed", lastError: "x" }] }) }),
    );
    expect(text(failedTab)).toContain("Regenerate PDF");
    expect(failedTab).toContain('role="status"');
  });
  it("PV6-04: sizes", () => {
    expect([
      kb(null),
      kb(0),
      kb(900),
      kb(1024),
      kb(1536),
      kb(10485760),
    ]).toEqual(["—", "0 B", "900 B", "1 KB", "2 KB", "10240 KB"]);
  });
  it("PV6-05: the buttons are at least 44 px tall and say what they do", () => {
    const dl = html(h(DownloadPdfButton, { versionId: "ver1" }));
    expect(dl).toContain("min-h-11");
    expect(text(dl)).toContain("Download");
    const rg = html(h(RegeneratePdfButton, { bookingId: "b1" }));
    expect(rg).toContain("min-h-11");
    expect(text(rg)).toContain("Regenerate PDF");
  });
});
