import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import type { CognosVaultFile } from "../vault.types";

import { CognosVaultPageComponent } from "./vault-page.component";

const FILES: CognosVaultFile[] = [
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
];

describe("CognosVaultPageComponent", () => {
  function render() {
    const fixture = TestBed.createComponent(CognosVaultPageComponent);
    fixture.componentRef.setInput("files", FILES);
    fixture.detectChanges();
    return fixture;
  }

  it("filters files by both search text and selected kind", () => {
    const fixture = render();
    const component = fixture.componentInstance as unknown as {
      search: { set: (value: string) => void };
      filter: { set: (value: "all" | "doc" | "image" | "sheet" | "audio") => void };
      filteredFiles: () => CognosVaultFile[];
    };

    component.search.set("bank");
    component.filter.set("sheet");
    fixture.detectChanges();

    expect(component.filteredFiles().map((file) => file.id)).toEqual(["v2"]);
  });

  it("shows the empty state when requested", () => {
    const fixture = render();
    fixture.componentRef.setInput("empty", true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("Your Vault is empty");
  });
});
