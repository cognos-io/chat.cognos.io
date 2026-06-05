import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import type { CognosVaultFile } from "../vault.types";

import { CognosVaultPickerComponent } from "./vault-picker.component";

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

describe("CognosVaultPickerComponent", () => {
  function render() {
    const fixture = TestBed.createComponent(CognosVaultPickerComponent);
    fixture.componentRef.setInput("files", FILES);
    fixture.componentRef.setInput("initialSelected", ["v1"]);
    fixture.detectChanges();
    return fixture;
  }

  it("keeps selection state while the search query changes", () => {
    const fixture = render();
    const component = fixture.componentInstance as unknown as {
      search: { set: (value: string) => void };
      isSelected: (id: string) => boolean;
    };

    component.search.set("bank");
    fixture.detectChanges();
    expect(component.isSelected("v1")).toBe(true);

    component.search.set("");
    fixture.detectChanges();
    expect(component.isSelected("v1")).toBe(true);
  });

  it("emits selected ids on attach and closes", () => {
    const fixture = render();
    const attach = vi.fn();
    const close = vi.fn();
    const component = fixture.componentInstance as unknown as {
      toggle: (id: string) => void;
      attachSelection: () => void;
    };

    fixture.componentInstance.attach.subscribe(attach);
    fixture.componentInstance.close.subscribe(close);

    component.toggle("v2");
    component.attachSelection();

    expect(attach).toHaveBeenCalledWith(["v1", "v2"]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
