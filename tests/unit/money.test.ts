import { describe, expect, it } from "vitest";
import {
  formatPaise,
  MoneyError,
  multiplyPaise,
  paiseToDecimalString,
  parseRupeesToPaise,
  sumPaise,
} from "@/lib/money";

describe("parseRupeesToPaise (TEST_PLAN 2.1)", () => {
  it.each([
    ["2500", 250000], // MON-01
    ["2,500.50", 250050], // MON-02
    ["2500.5", 250050], // MON-02
    ["1,50,000", 15000000], // MON-03 Indian grouping
    ["150,000", 15000000], // international grouping
    ["₹ 5,000", 500000],
    ["0", 0],
    ["0.01", 1],
    [".5", 50],
    ["  750  ", 75000],
    ["99,99,99,999", 99999999900], // MON-08 (999,999,999 rupees)
  ])("parses %j → %d paise", (input, expected) => {
    expect(parseRupeesToPaise(input)).toBe(expected);
  });

  it("MON-04: 0.1 + 0.2 is exactly 30 paise", () => {
    expect(parseRupeesToPaise("0.1") + parseRupeesToPaise("0.2")).toBe(30);
  });

  it.each([
    ["12.345", "TOO_MANY_DECIMALS"],
    ["-5", "NEGATIVE"],
    ["abc", "INVALID_FORMAT"],
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["1e5", "INVALID_FORMAT"],
    ["1,2,3", "INVALID_FORMAT"],
    ["12,34", "INVALID_FORMAT"],
    ["1.2.3", "INVALID_FORMAT"],
    ["99999999999999", "TOO_LARGE"],
  ])("MON-05: rejects %j (%s)", (input, code) => {
    try {
      parseRupeesToPaise(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MoneyError);
      expect((e as MoneyError).code).toBe(code);
    }
  });
});

describe("formatPaise", () => {
  it("MON-06: Indian grouping", () => {
    expect(formatPaise(15000000)).toBe("₹1,50,000");
  });
  it("MON-07: shows paise when present", () => {
    expect(formatPaise(250050)).toBe("₹2,500.50");
    expect(formatPaise(5)).toBe("₹0.05");
  });
  it("alwaysShowPaise", () => {
    expect(formatPaise(500000, { alwaysShowPaise: true })).toBe("₹5,000.00");
  });
  it("negative values (adjustments)", () => {
    expect(formatPaise(-50000)).toBe("−₹500");
  });
  it("large values are exact", () => {
    expect(formatPaise(9999999999)).toBe("₹9,99,99,999.99");
  });
  it("rejects non-integer paise", () => {
    expect(() => formatPaise(1.5)).toThrow(MoneyError);
  });
});

describe("arithmetic helpers", () => {
  it("MON-08 / AMT: 2 × ₹2,500 = ₹5,000", () => {
    expect(multiplyPaise(250000, 2)).toBe(500000);
  });
  it("multiply rejects fractional factors and overflow", () => {
    expect(() => multiplyPaise(100, 1.5)).toThrow(MoneyError);
    expect(() => multiplyPaise(1e14, 1000, 1000)).toThrow(MoneyError);
  });
  it("sumPaise", () => {
    expect(sumPaise([150000, 350000])).toBe(500000);
    expect(() => sumPaise([0.5])).toThrow(MoneyError);
  });
  it("paiseToDecimalString for CSV", () => {
    expect(paiseToDecimalString(250050)).toBe("2500.50");
    expect(paiseToDecimalString(-5)).toBe("-0.05");
    expect(paiseToDecimalString(0)).toBe("0.00");
  });
});
