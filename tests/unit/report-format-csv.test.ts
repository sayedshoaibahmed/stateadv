import { describe, expect, it } from "vitest";
import {
  BOM,
  csvCell,
  csvHeader,
  csvLine,
  csvNote,
  csvRow,
  csvTotals,
} from "@/lib/reports/csv";
import {
  cellCsv,
  cellText,
  istStamp,
  isFreeText,
  statusWord,
} from "@/lib/reports/format";
import {
  REPORTS,
  REPORT_KEYS,
  parseReportFilter,
  type Column,
} from "@/lib/reports/definitions";

describe("what a cell says (RF-01..)", () => {
  it("RF-01: money is rupees the Indian way on the screen and in the PDF, and plain decimals in the CSV", () => {
    expect(cellText("money", 15000000)).toBe("₹1,50,000");
    expect(cellText("money", 250050)).toBe("₹2,500.50");
    expect(cellText("money", -50000)).toBe("−₹500");
    expect(cellText("money", 0)).toBe("₹0");
    expect(cellCsv("money", 250050)).toBe("2500.50");
    expect(cellCsv("money", -5)).toBe("-0.05");
    expect(cellCsv("money", 0)).toBe("0.00");
    expect(cellCsv("money", 100)).toBe("1.00");
  });
  it("RF-02: dates are '10 Mar 2026' for people and ISO for the spreadsheet; moments are in India time", () => {
    expect(cellText("date", "2026-03-10")).toBe("10 Mar 2026");
    expect(cellCsv("date", "2026-03-10")).toBe("2026-03-10");
    // 23:30 IST on 31 March is 18:00 UTC the same day; 00:30 IST on 2 April is 19:00 UTC on 1 April
    expect(cellText("datetime", "2026-03-31T18:00:00+00:00")).toBe(
      "31 Mar 2026, 11:30 PM",
    );
    expect(cellCsv("datetime", "2026-03-31T18:00:00+00:00")).toBe(
      "2026-03-31 23:30",
    );
    expect(cellCsv("datetime", "2026-04-01T19:00:00Z")).toBe(
      "2026-04-02 00:30",
    );
    expect(istStamp("not a time")).toBeNull();
  });
  it("RF-03: empty values are a dash on the screen and nothing in the CSV; nothing throws on odd input", () => {
    for (const k of [
      "text",
      "code",
      "int",
      "money",
      "date",
      "datetime",
    ] as const) {
      expect(cellText(k, null)).toBe("—");
      expect(cellText(k, "")).toBe("—");
      expect(cellCsv(k, null)).toBe("");
    }
    expect(cellText("money", "12")).toBe("—");
    expect(cellText("date", "garbage")).toBe("—");
    expect(cellText("datetime", "garbage")).toBe("—");
    expect(cellCsv("date", "garbage")).toBe("");
    expect(cellCsv("money", "12")).toBe("");
  });
  it("RF-04: statuses are words", () => {
    expect(cellText("approval", "waiting")).toBe("Waiting for Approval");
    expect(cellText("booking-status", "no_show")).toBe("No-show");
    expect(cellCsv("booking-status", "checked_in")).toBe("Checked-in");
    expect(statusWord("something_new")).toBe("something_new");
  });
  it("RF-05: whole numbers and text are written as they are; only free text is guarded in the CSV", () => {
    expect(cellText("int", 0)).toBe("0");
    expect(cellText("int", 12)).toBe("12");
    expect(cellText("text", "Asha Rao")).toBe("Asha Rao");
    expect(isFreeText("text")).toBe(true);
    expect(isFreeText("code")).toBe(true);
    expect(isFreeText("approval")).toBe(true); // our own words, guarded anyway
    expect(isFreeText("booking-status")).toBe(true);
    for (const k of ["int", "money", "date", "datetime"] as const)
      expect(isFreeText(k)).toBe(false);
  });
});

describe("CSV files (CSV-01..)", () => {
  it("CSV-01: the byte-order mark is the UTF-8 one, so Excel reads rupee signs and names correctly", () => {
    expect(BOM).toBe("﻿");
    expect(new TextEncoder().encode(BOM)).toEqual(
      new Uint8Array([0xef, 0xbb, 0xbf]),
    );
  });
  it("CSV-02 (SEC-08): text that starts with = + - @ tab or carriage return is stopped from running as a formula", () => {
    for (const v of [
      "=1+1",
      "+91 98765 43210",
      "-5 Test",
      "@SUM(A1)",
      "\tTAB",
      "\rCR",
      '=HYPERLINK("http://x","y")',
      "=cmd|' /C calc'!A0",
    ]) {
      const out = csvCell(v, true);
      expect(out.replace(/^"/, "").startsWith("'"), v).toBe(true);
    }
    expect(csvCell("=1+1", true)).toBe("'=1+1");
    expect(csvCell("+91 98765", true)).toBe("'+91 98765");
    expect(csvCell("Asha =Rao", true)).toBe("Asha =Rao"); // only the FIRST character matters
    expect(csvCell("Rao-Singh", true)).toBe("Rao-Singh");
  });
  it("CSV-03: numbers and dates are never given the apostrophe: a negative amount stays a number", () => {
    expect(csvCell("-500.00", false)).toBe("-500.00");
    expect(
      csvRow([{ key: "a", label: "A", kind: "money" }], { a: -50000 }),
    ).toBe("-500.00\r\n");
  });
  it("CSV-04: quotes, commas and new lines make the cell quoted, with quotes doubled (RFC 4180)", () => {
    expect(csvCell("plain", false)).toBe("plain");
    expect(csvCell("a,b", false)).toBe('"a,b"');
    expect(csvCell('say "hi"', false)).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2", false)).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2", false)).toBe('"line1\r\nline2"');
    expect(csvCell("=A,B", true)).toBe('"\'=A,B"');
    expect(csvCell("Zoë ₹ नमस्ते", true)).toBe("Zoë ₹ नमस्ते"); // unicode stays as it is
  });
  it("CSV-05: lines end with CRLF; a note is one guarded cell", () => {
    expect(csvLine(["a", "b"])).toBe("a,b\r\n");
    expect(csvNote("Date used: By payment date")).toBe(
      "Date used: By payment date\r\n",
    );
    expect(csvNote("=evil()")).toBe("'=evil()\r\n");
    expect(csvNote("Period: 1 Mar 2026 – 31 Mar 2026, all resorts")).toBe(
      '"Period: 1 Mar 2026 – 31 Mar 2026, all resorts"\r\n',
    );
  });
  const cols: Column[] = [
    { key: "name", label: "Guest", kind: "text" },
    { key: "when", label: "Date", kind: "date" },
    { key: "amt", label: "Amount", kind: "money" },
    { key: "n", label: "PAX", kind: "int" },
    { key: "st", label: "Status", kind: "approval" },
  ];
  it("CSV-06: a header row and a data row, with rupees in two decimals, ISO dates, status words and the guard on the name", () => {
    expect(csvHeader(cols)).toBe("Guest,Date,Amount,PAX,Status\r\n");
    expect(
      csvRow(cols, {
        name: "=Asha",
        when: "2026-03-10",
        amt: 250050,
        n: 2,
        st: "waiting",
      }),
    ).toBe("'=Asha,2026-03-10,2500.50,2,Waiting for Approval\r\n");
    expect(
      csvRow(cols, { name: null, when: null, amt: null, n: null, st: null }),
    ).toBe(",,,,\r\n");
  });
  it("CSV-07: the totals row says 'Total' in the first column when the first column has no total, and puts the figures under their columns", () => {
    expect(
      csvTotals(cols, { amt: "sum", n: "pax" }, { sum: 1500000, pax: 16 }),
    ).toBe("Total,,15000.00,16,\r\n");
    // when the first column itself has a total, there is no 'Total' label over it
    expect(csvTotals(cols, { name: "x" }, { x: 5 })).toBe(
      "5,,,,\r\n".replace("5", cellCsv("text", 5)),
    );
    expect(csvTotals(cols, {}, {})).toBe("Total,,,,\r\n");
  });
});

const DANGEROUS = [
  "=",
  "+",
  "-",
  "@",
  String.fromCharCode(9),
  String.fromCharCode(13),
];

describe("the formula guard reaches every user-controlled column of every report (CSV-08)", () => {
  it("CSV-08: with '=cmd' in every cell of every report, no text cell starts with a formula sign, and no column is typed so that it passes text through unguarded", () => {
    for (const key of REPORT_KEYS) {
      const def = REPORTS[key];
      const f = parseReportFilter(def, {}, "2026-03-31");
      const columns = def.columns(f);
      const row: Record<string, string> = {};
      for (const c of columns) row[c.key] = "=cmd|' /C calc'!A0";
      const line = csvRow(columns, row).trimEnd();
      // every cell, as the file would hold it, is either empty or starts with ' or a quote
      for (const [i, c] of columns.entries()) {
        const cell = csvCell(cellCsv(c.kind, row[c.key]), isFreeText(c.kind));
        expect(
          DANGEROUS.includes(cell.charAt(0)) && cell !== "",
          `${key}.${c.key}`,
        ).toBe(false);
        expect(i).toBeLessThan(columns.length);
      }
      expect(line.length).toBeGreaterThan(0);
    }
  });
  it("CSV-09: money and number cells can be negative (-500.00) without an apostrophe: they are built from numbers, never from text", () => {
    expect(csvCell(cellCsv("money", -50000), isFreeText("money"))).toBe(
      "-500.00",
    );
    expect(cellCsv("money", "=1+1")).toBe("");
    expect(cellCsv("date", "=1+1")).toBe("");
  });
});
