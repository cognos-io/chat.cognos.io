import { describe, expect, it } from "vitest";

import {
  deriveFileExtension,
  normaliseFileExtension,
  resolveFileType,
} from "./file-types";

describe("file-types", () => {
  it("normalises case and leading dots", () => {
    expect(normaliseFileExtension(".PDF")).toBe("pdf");
  });

  it("derives extensions from filenames and falls back to file", () => {
    expect(deriveFileExtension("brief.docx")).toBe("docx");
    expect(deriveFileExtension("README")).toBe("file");
  });

  it("resolves known types and gives unknown types a neutral file fallback", () => {
    expect(resolveFileType("csv")).toEqual({
      icon: "table",
      tone: "green",
      label: "CSV",
    });

    expect(resolveFileType("foo")).toEqual({
      icon: "file",
      tone: "neutral",
      label: "FOO",
    });
  });
});
