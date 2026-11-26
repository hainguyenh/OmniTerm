import { describe, expect, it } from "vitest";
import { onOtherShare } from "../paths";

const raw = String.raw;

describe("onOtherShare", () => {
  it("is true for a share the base is not on", () => {
    for (const base of ["C:/repo/a.md", "", "//nas/work/a.md", "//evil/other/a.md", "//evil"]) {
      expect(onOtherShare("//evil/share/a.png", base), base).toBe(true);
      expect(onOtherShare(raw`\\evil\share\a.png`, base), base).toBe(true);
    }
    // A server alone, and spellings with no server to compare.
    for (const path of ["//evil", "//evil/", raw`/\\evil/share/a.png`]) {
      expect(onOtherShare(path, "//evil/share/a.md"), path).toBe(true);
    }
  });

  // A project on a share gets its paths from the host as `//?/UNC/server/share/…`.
  it("reads the server and share of a device path", () => {
    const base = "//?/UNC/nas/work/app/a.md";
    expect(onOtherShare("//?/UNC/evil/share/a.png", base)).toBe(true);
    expect(onOtherShare("//?/UNC/nas/private/a.png", base)).toBe(true);
    expect(onOtherShare("//evil/share/a.png", base)).toBe(true);
    expect(onOtherShare("//?/UNC", base)).toBe(true);
    expect(onOtherShare("//?/C:/a.png", "//?/C:/a.md")).toBe(true);
    expect(onOtherShare("//?/unc/NAS/Work/lib/a.png", base)).toBe(false);
    expect(onOtherShare("//nas/work/lib/a.png", base)).toBe(false);
    expect(onOtherShare("//?/UNC/nas/work/lib/a.png", "//nas/work/app/a.md")).toBe(false);
  });

  it("is false on the base's own share and off any share", () => {
    expect(onOtherShare("//NAS/Work/lib/a.png", "//nas/work/app/a.md")).toBe(false);
    expect(onOtherShare(raw`\\nas\work\lib\a.png`, "//nas/work/app/a.md")).toBe(false);
    expect(onOtherShare("C:/repo/a.png", "//nas/work/app/a.md")).toBe(false);
    expect(onOtherShare("/abs/a.png", "C:/repo/a.md")).toBe(false);
  });
});
