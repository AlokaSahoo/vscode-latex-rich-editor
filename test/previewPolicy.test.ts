import { describe, expect, it } from "vitest";
import { previewAfterCompile, statusText } from "../src/compile/previewPolicy";
import { clampFontScale } from "../src/shared/layout";

describe("previewAfterCompile", () => {
  it("does not open the PDF after a plain compile", () => {
    expect(previewAfterCompile({ requested: false, previewOpen: false, autoOpen: false }).show).toBe(false);
  });
  it("refreshes an open preview without taking focus", () => {
    expect(previewAfterCompile({ requested: false, previewOpen: true, autoOpen: false })).toEqual({ show: true, quiet: true });
  });
  it("opens the PDF when the user asked for it", () => {
    expect(previewAfterCompile({ requested: true, previewOpen: false, autoOpen: false })).toEqual({ show: true, quiet: false });
  });
  it("honours the openPdfAfterCompile setting", () => {
    expect(previewAfterCompile({ requested: false, previewOpen: false, autoOpen: true }).show).toBe(true);
  });
});

describe("statusText", () => {
  it("is hidden when idle", () => expect(statusText({ kind: "idle" })).toBeUndefined());
  it("pluralises counts", () => {
    expect(statusText({ kind: "error", errors: 1 })!.text).toContain("1 error");
    expect(statusText({ kind: "error", errors: 2 })!.text).toContain("2 errors");
    expect(statusText({ kind: "ok", warnings: 0 })!.text).toBe("$(check) LaTeX: OK");
  });
});

describe("clampFontScale", () => {
  it("keeps the text size in range and rounds steps", () => {
    expect(clampFontScale(0.1)).toBe(0.6);
    expect(clampFontScale(9)).toBe(2.5);
    expect(clampFontScale(1.1 + 0.1)).toBe(1.2);
    expect(clampFontScale(NaN)).toBe(1);
  });
});
