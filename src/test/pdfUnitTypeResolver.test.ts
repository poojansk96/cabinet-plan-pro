// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  extractPreferredUnitTypeFromPageText,
  resolvePreferredUnitType,
  normalizeResolvedUnitType,
  isSuspiciousUnitTypeCandidate,
} from "../lib/pdfUnitTypeResolver";

describe("pdfUnitTypeResolver", () => {
  it("prefers a strong standalone title-block type from page text", () => {
    const pageText = [
      "Tackenash Knoll",
      "TYPE 10 - AS",
      "Building 5 - Unit C",
      "Building 8 - Unit C",
      "Building 9 - Unit C",
    ].join("\n");

    expect(extractPreferredUnitTypeFromPageText(pageText)).toBe("TYPE 10-AS");
  });

  it("overrides weak AI type with stronger page-text type when they conflict", () => {
    const pageText = [
      "Tackenash Knoll",
      "TYPE 10 - AS",
      "Building 5 - Unit C",
      "Building 8 - Unit C",
    ].join("\n");

    expect(resolvePreferredUnitType("TYPE 1 - AS", pageText)).toBe("TYPE 10-AS");
  });

  it("prefers common-area labels over unit numbers", () => {
    const pageText = [
      "BLDG 13",
      "UNIT 13C",
      "KITCHENETTE",
    ].join("\n");

    expect(resolvePreferredUnitType("13C", pageText, "13C")).toBe("Kitchenette");
  });

  it("extracts TYPE with suffix -AS", () => {
    const pageText = "TYPE 10 - AS\nSome other text";
    expect(extractPreferredUnitTypeFromPageText(pageText)).toBe("TYPE 10-AS");
  });

  it("extracts TYPE with suffix -MIRROR", () => {
    const pageText = "TYPE 1 - MIRROR\nSome other text";
    expect(extractPreferredUnitTypeFromPageText(pageText)).toBe("TYPE 1-MIRROR");
  });

  it("keeps -AS and -MIRROR as separate types", () => {
    const t1 = normalizeResolvedUnitType("TYPE 1 - AS");
    const t2 = normalizeResolvedUnitType("TYPE 1 - MIRROR");
    expect(t1).toBe("TYPE 1-AS");
    expect(t2).toBe("TYPE 1-MIRROR");
    expect(t1).not.toBe(t2);
  });

  it("extracts all TYPE patterns from multi-line text", () => {
    // Simulate a page that has TYPE 10-AS in the title block
    const pageText = [
      "Project Name",
      "TYPE 10 - AS",
      "Kitchen Layout",
      "25.5 x 96",
    ].join("\n");
    expect(extractPreferredUnitTypeFromPageText(pageText)).toBe("TYPE 10-AS");
  });

  it("does not confuse building numbers for types", () => {
    expect(isSuspiciousUnitTypeCandidate("BLDG 5")).toBe(true);
    expect(isSuspiciousUnitTypeCandidate("13C")).toBe(true);
    expect(isSuspiciousUnitTypeCandidate("TYPE 10-AS")).toBe(false);
    expect(isSuspiciousUnitTypeCandidate("Kitchenette")).toBe(false);
  });

  it("resolves when AI returns empty but page text has type", () => {
    const pageText = "TYPE 5-MIRROR\nKitchen Plan";
    expect(resolvePreferredUnitType("", pageText)).toBe("TYPE 5-MIRROR");
  });

  it("resolves when AI returns building label but page text has real type", () => {
    const pageText = "TYPE 3\nBLDG 7\nFloor Plan";
    expect(resolvePreferredUnitType("BLDG 7", pageText)).toBe("TYPE 3");
  });

  it("handles STUDIO type", () => {
    const pageText = "STUDIO TYPE A\nLayout";
    expect(extractPreferredUnitTypeFromPageText(pageText)).toBe("STUDIO TYPE A");
  });

  it("handles bedroom-count types", () => {
    const pageText = "2BR TYPE C-ADA\nFloor Plan";
    expect(extractPreferredUnitTypeFromPageText(pageText)).toBe("2BR TYPE C-ADA");
  });
});
