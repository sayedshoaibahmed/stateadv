import { describe, expect, it } from "vitest";
import {
  MAX_LOGO_BYTES,
  MAX_PROOF_BYTES,
  checkClaim,
  checkContent,
  detectMime,
  extensionFor,
  isProofPathFor,
  isUuid,
  logoPath,
  proofPath,
  sha256Hex,
} from "@/lib/storage/files";

const BOOKING = "0a1b2c3d-1111-4222-8333-444455556666";
const bytes = (...n: number[]) => new Uint8Array(n);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
const PDF = new TextEncoder().encode("%PDF-1.7\n...");

describe("file type by content (not by name)", () => {
  it("STO-U1: recognises JPG, PNG, WEBP and PDF from their first bytes", () => {
    expect(detectMime(JPG)).toBe("image/jpeg");
    expect(detectMime(PNG)).toBe("image/png");
    expect(detectMime(WEBP)).toBe("image/webp");
    expect(detectMime(PDF)).toBe("application/pdf");
  });
  it("STO-U2: rejects scripts, HTML, SVG, executables, empty and truncated files", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    for (const bad of [
      enc("<html><script>alert(1)</script>"),
      enc('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      enc("MZ\u0090\u0000\u0003"),
      enc("#!/bin/sh\nrm -rf /"),
      enc("GIF89a"),
      new Uint8Array(0),
      bytes(0xff, 0xd8),
      bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45), // RIFF WAVE
    ]) {
      expect(detectMime(bad)).toBeNull();
    }
  });
  it("STO-U3: a file that claims to be one thing but is another is refused", () => {
    expect(checkContent(PNG, "image/png").ok).toBe(true);
    expect(checkContent(PNG, "image/jpeg").ok).toBe(false);
    expect(checkContent(PDF, "image/png").ok).toBe(false);
    expect(
      checkContent(new TextEncoder().encode("hello"), "image/png").ok,
    ).toBe(false);
  });
  it("STO-U4: logos allow pictures only (no PDF); proofs allow PDF", () => {
    expect(checkContent(PDF, "application/pdf", "resort-logos").ok).toBe(false);
    expect(checkContent(PNG, "image/png", "resort-logos").ok).toBe(true);
    expect(checkContent(PDF, "application/pdf").ok).toBe(true);
  });
});

describe("size and type claims before upload", () => {
  it("STO-U5: size limits: 10 MB for proofs, 2 MB for logos, no empty files", () => {
    expect(
      checkClaim({ name: "a.png", size: MAX_PROOF_BYTES, type: "image/png" })
        .ok,
    ).toBe(true);
    expect(
      checkClaim({
        name: "a.png",
        size: MAX_PROOF_BYTES + 1,
        type: "image/png",
      }).ok,
    ).toBe(false);
    expect(checkClaim({ name: "a.png", size: 0, type: "image/png" }).ok).toBe(
      false,
    );
    expect(checkClaim({ name: "a.png", size: 1.5, type: "image/png" }).ok).toBe(
      false,
    );
    expect(
      checkClaim(
        { name: "a.png", size: MAX_LOGO_BYTES, type: "image/png" },
        "resort-logos",
      ).ok,
    ).toBe(true);
    expect(
      checkClaim(
        { name: "a.png", size: MAX_LOGO_BYTES + 1, type: "image/png" },
        "resort-logos",
      ).ok,
    ).toBe(false);
  });
  it("STO-U6: only JPG/PNG/WEBP/PDF are accepted; SVG, HTML, GIF and executables are not", () => {
    for (const type of [
      "image/svg+xml",
      "text/html",
      "image/gif",
      "application/x-msdownload",
      "",
      "image/png; charset=x",
    ]) {
      expect(checkClaim({ name: "a", size: 10, type }).ok, type).toBe(false);
    }
    expect(
      checkClaim(
        { name: "a", size: 10, type: "application/pdf" },
        "resort-logos",
      ).ok,
    ).toBe(false);
  });
  it("STO-U7: the fingerprint is SHA-256", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("server-chosen file names", () => {
  it("STO-U8: proof and logo names have the shape the storage policies allow, and are never repeated", () => {
    const a = proofPath("payment", BOOKING, "image/png");
    const b = proofPath("payment", BOOKING, "image/png");
    expect(a).not.toBe(b);
    expect(a).toMatch(new RegExp(`^${BOOKING}/[0-9a-f-]{36}\\.png$`));
    expect(proofPath("refund", BOOKING, "application/pdf")).toMatch(
      new RegExp(`^refunds/${BOOKING}/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(logoPath(BOOKING, "image/webp")).toMatch(
      new RegExp(`^${BOOKING}/[0-9a-f-]{36}\\.webp$`),
    );
  });
  it("STO-U9: bad inputs never produce a name (no path tricks)", () => {
    for (const id of ["../x", "", "not-a-uuid", `${BOOKING}/../x`]) {
      expect(() => proofPath("payment", id, "image/png")).toThrow();
      expect(() => logoPath(id, "image/png")).toThrow();
    }
    expect(() => proofPath("payment", BOOKING, "text/html")).toThrow();
    expect(() => logoPath(BOOKING, "application/pdf")).toThrow();
    expect(extensionFor("image/gif")).toBeNull();
    expect(isUuid("../x")).toBe(false);
  });
  it("STO-U10: a path is accepted only for the right booking and kind (cross-booking and cross-kind are refused)", () => {
    const pay = proofPath("payment", BOOKING, "image/png");
    const ref = proofPath("refund", BOOKING, "image/png");
    expect(isProofPathFor(pay, "payment", BOOKING)).toBe(true);
    expect(isProofPathFor(ref, "refund", BOOKING)).toBe(true);
    expect(isProofPathFor(pay, "refund", BOOKING)).toBe(false);
    expect(isProofPathFor(ref, "payment", BOOKING)).toBe(false);
    expect(
      isProofPathFor(pay, "payment", "ffffffff-1111-4222-8333-444455556666"),
    ).toBe(false);
    for (const bad of [
      `${BOOKING}/x.png`,
      `../${BOOKING}/x.png`,
      `${pay}/../../etc`,
      `${pay}.exe`,
      pay.toUpperCase(),
    ]) {
      expect(isProofPathFor(bad, "payment", BOOKING), bad).toBe(false);
    }
  });
});
