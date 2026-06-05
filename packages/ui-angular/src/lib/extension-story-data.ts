import type { CognosVaultFile } from "./vault/vault.types";

export const STORY_COSMOS_IMAGE = "/assets/bg-cosmos.png";
export const STORY_RIPPLES_IMAGE = "/assets/bg-water-ripples.png";

export const STORY_IMAGES = [
  STORY_COSMOS_IMAGE,
  STORY_RIPPLES_IMAGE,
  STORY_COSMOS_IMAGE,
  STORY_RIPPLES_IMAGE,
  STORY_COSMOS_IMAGE,
];

export const STORY_VAULT_FILES: CognosVaultFile[] = [
  {
    id: "v1",
    name: "Tenancy agreement.pdf",
    ext: "pdf",
    size: "1.2 MB",
    meta: "PDF · 9 pages",
    kind: "doc",
    refs: 3,
    when: "2 weeks ago",
  },
  {
    id: "v2",
    name: "Bank statements Q1.csv",
    ext: "csv",
    size: "88 KB",
    meta: "412 rows",
    kind: "sheet",
    refs: 5,
    when: "3 days ago",
  },
  {
    id: "v3",
    name: "Passport scan.jpg",
    ext: "jpg",
    size: "2.1 MB",
    meta: "3024 × 4032",
    kind: "image",
    refs: 0,
    when: "Apr",
    img: STORY_RIPPLES_IMAGE,
  },
  {
    id: "v4",
    name: "Voice memo — ideas.m4a",
    ext: "m4a",
    size: "1.0 MB",
    meta: "Audio · 3:12",
    kind: "audio",
    refs: 0,
    when: "Yesterday",
  },
];
