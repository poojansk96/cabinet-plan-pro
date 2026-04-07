import { describe, expect, it } from "vitest";
import {
  extractPreferredUnitTypeFromPageText,
  resolvePreferredUnitType,
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
});
