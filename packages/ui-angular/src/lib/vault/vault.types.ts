export type CognosVaultFileKind = "doc" | "image" | "sheet" | "audio";

export type CognosVaultFile = {
  id: string;
  name: string;
  ext: string;
  size: string;
  meta: string;
  kind: CognosVaultFileKind;
  refs: number;
  when: string;
  img?: string;
};

export type CognosVaultFilter = "all" | CognosVaultFileKind;

export type CognosStorageSegment = {
  label: string;
  tone: "blue" | "green" | "purple" | "red";
  used: number;
};
