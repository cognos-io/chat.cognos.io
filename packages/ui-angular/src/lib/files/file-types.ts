import type { CognosIconName } from "@cognos/ui/icons";

import type { CognosLozengeTone } from "../primitives/lozenge/lozenge.component";

export type CognosFileTone = CognosLozengeTone;

export type CognosFileType = {
  icon: CognosIconName;
  tone: CognosFileTone;
  label: string;
};

const FILE_TYPES: Record<string, CognosFileType> = {
  pdf: { icon: "file-text", tone: "red", label: "PDF" },
  docx: { icon: "file-text", tone: "blue", label: "DOCX" },
  doc: { icon: "file-text", tone: "blue", label: "DOC" },
  txt: { icon: "file-text", tone: "neutral", label: "TXT" },
  md: { icon: "file-text", tone: "neutral", label: "MD" },
  rtf: { icon: "file-text", tone: "neutral", label: "RTF" },
  csv: { icon: "table", tone: "green", label: "CSV" },
  xlsx: { icon: "table", tone: "green", label: "XLSX" },
  png: { icon: "image", tone: "purple", label: "PNG" },
  jpg: { icon: "image", tone: "purple", label: "JPG" },
  jpeg: { icon: "image", tone: "purple", label: "JPG" },
  webp: { icon: "image", tone: "purple", label: "WEBP" },
  mp3: { icon: "music", tone: "purple", label: "MP3" },
  wav: { icon: "music", tone: "purple", label: "WAV" },
  m4a: { icon: "music", tone: "purple", label: "M4A" },
};

export function normaliseFileExtension(ext: string | null | undefined): string {
  return String(ext ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
}

export function deriveFileExtension(name: string | null | undefined): string {
  const value = String(name ?? "").trim();
  const parts = value.split(".");

  if (parts.length < 2) {
    return "file";
  }

  return normaliseFileExtension(parts.at(-1));
}

export function resolveFileType(ext: string | null | undefined): CognosFileType {
  const key = normaliseFileExtension(ext);
  const known = FILE_TYPES[key];

  if (known) {
    return known;
  }

  return {
    icon: "file",
    tone: "neutral",
    label: key ? key.toUpperCase() : "FILE",
  };
}
