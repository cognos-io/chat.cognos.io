import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CognosToggleComponent } from "./toggle.component";

describe("CognosToggleComponent", () => {
  it("emits the inverted checked value when clicked", () => {
    const fixture = TestBed.createComponent(CognosToggleComponent);
    fixture.componentRef.setInput("checked", false);
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.checkedChange.subscribe(listener);

    (fixture.nativeElement.querySelector("button") as HTMLButtonElement).click();

    expect(listener).toHaveBeenCalledWith(true);
  });

  it("inverts again when starting from a checked state", () => {
    const fixture = TestBed.createComponent(CognosToggleComponent);
    fixture.componentRef.setInput("checked", true);
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.checkedChange.subscribe(listener);

    (fixture.nativeElement.querySelector("button") as HTMLButtonElement).click();

    expect(listener).toHaveBeenCalledWith(false);
  });

  it("reflects the checked state on the button (class + aria-checked)", () => {
    const fixture = TestBed.createComponent(CognosToggleComponent);
    fixture.componentRef.setInput("checked", true);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
    expect(button.className).toContain("cog-toggle--checked");
    expect(button.getAttribute("aria-checked")).toBe("true");
  });

  it("forwards the label as aria-label and omits it when blank", () => {
    const fixture = TestBed.createComponent(CognosToggleComponent);
    fixture.detectChanges();
    let button = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBeNull();

    fixture.componentRef.setInput("label", "Sync");
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Sync");
  });
});
