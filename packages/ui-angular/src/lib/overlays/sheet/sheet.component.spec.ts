import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CognosSheetComponent } from "./sheet.component";

describe("CognosSheetComponent", () => {
  it("renders nothing when closed", () => {
    const fixture = TestBed.createComponent(CognosSheetComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".cog-sheet")).toBeNull();
  });

  it("hides the header when no title is set and full is false", () => {
    const fixture = TestBed.createComponent(CognosSheetComponent);
    fixture.componentRef.setInput("open", true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".cog-sheet__header")).toBeNull();
  });

  it("renders the header when a title is provided", () => {
    const fixture = TestBed.createComponent(CognosSheetComponent);
    fixture.componentRef.setInput("open", true);
    fixture.componentRef.setInput("title", "Filters");
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector(".cog-sheet__title");
    expect(title?.textContent?.trim()).toBe("Filters");
  });

  it("renders the header in full mode even without a title", () => {
    const fixture = TestBed.createComponent(CognosSheetComponent);
    fixture.componentRef.setInput("open", true);
    fixture.componentRef.setInput("full", true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".cog-sheet__header")).toBeTruthy();
  });

  it("combines the full and footer modifiers on the panel", () => {
    const fixture = TestBed.createComponent(CognosSheetComponent);
    fixture.componentRef.setInput("open", true);
    fixture.componentRef.setInput("full", true);
    fixture.componentRef.setInput("stickyFooter", true);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector(".cog-sheet__panel") as HTMLElement;
    expect(panel.className).toContain("cog-sheet__panel--full");
    expect(panel.className).toContain("cog-sheet__panel--footer");
  });

  it("emits close when the scrim is clicked", () => {
    const fixture = TestBed.createComponent(CognosSheetComponent);
    fixture.componentRef.setInput("open", true);
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.close.subscribe(listener);

    (fixture.nativeElement.querySelector(".cog-sheet__scrim") as HTMLButtonElement).click();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
