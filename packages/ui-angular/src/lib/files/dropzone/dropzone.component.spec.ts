import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CognosDropzoneComponent } from "./dropzone.component";

describe("CognosDropzoneComponent", () => {
  function render() {
    const fixture = TestBed.createComponent(CognosDropzoneComponent);
    fixture.detectChanges();
    return fixture;
  }

  it("toggles the dragging class across nested drag enter and leave events", () => {
    const fixture = render();
    const host = fixture.nativeElement.querySelector(".cog-dropzone") as HTMLElement;

    host.dispatchEvent(new Event("dragenter", { bubbles: true }));
    host.dispatchEvent(new Event("dragenter", { bubbles: true }));
    fixture.detectChanges();
    expect(host.className).toContain("cog-dropzone--dragging");

    host.dispatchEvent(new Event("dragleave", { bubbles: true }));
    fixture.detectChanges();
    expect(host.className).toContain("cog-dropzone--dragging");

    host.dispatchEvent(new Event("dragleave", { bubbles: true }));
    fixture.detectChanges();
    expect(host.className).not.toContain("cog-dropzone--dragging");
  });

  it("emits dropped files and resets the drag state", () => {
    const fixture = render();
    const listener = vi.fn();
    const host = fixture.nativeElement.querySelector(".cog-dropzone") as HTMLElement;
    const files = { length: 1, item: vi.fn() } as unknown as FileList;

    fixture.componentInstance.filesSelected.subscribe(listener);
    host.dispatchEvent(new Event("dragenter", { bubbles: true }));
    const dropEvent = new Event("drop", { bubbles: true }) as DragEvent;
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { files } as DataTransfer,
    });
    host.dispatchEvent(dropEvent);
    fixture.detectChanges();

    expect(listener).toHaveBeenCalledWith(files);
    expect(host.className).not.toContain("cog-dropzone--dragging");
  });
});
