import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CognosDrawerComponent } from "./drawer.component";

describe("CognosDrawerComponent", () => {
  it("renders nothing when closed", () => {
    const fixture = TestBed.createComponent(CognosDrawerComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".cog-drawer")).toBeNull();
  });

  it("renders the panel when open", () => {
    const fixture = TestBed.createComponent(CognosDrawerComponent);
    fixture.componentRef.setInput("open", true);
    fixture.componentRef.setInput("title", "Menu");
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector(".cog-drawer__panel");
    const title = fixture.nativeElement.querySelector(".cog-drawer__title");

    expect(panel).toBeTruthy();
    expect(title?.textContent?.trim()).toBe("Menu");
  });

  it("applies the footer modifier when stickyFooter is true", () => {
    const fixture = TestBed.createComponent(CognosDrawerComponent);
    fixture.componentRef.setInput("open", true);
    fixture.componentRef.setInput("stickyFooter", true);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector(".cog-drawer__panel") as HTMLElement;
    expect(panel.className).toContain("cog-drawer__panel--footer");
  });

  it("emits close when the scrim is clicked", () => {
    const fixture = TestBed.createComponent(CognosDrawerComponent);
    fixture.componentRef.setInput("open", true);
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.close.subscribe(listener);

    (fixture.nativeElement.querySelector(".cog-drawer__scrim") as HTMLButtonElement).click();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
