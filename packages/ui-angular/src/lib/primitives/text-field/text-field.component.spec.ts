import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CognosTextFieldComponent } from "./text-field.component";

describe("CognosTextFieldComponent", () => {
  it("emits valueChange with the typed value", () => {
    const fixture = TestBed.createComponent(CognosTextFieldComponent);
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.valueChange.subscribe(listener);

    const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));

    expect(listener).toHaveBeenCalledWith("hello");
  });

  it("applies the disabled modifier and disables the input", () => {
    const fixture = TestBed.createComponent(CognosTextFieldComponent);
    fixture.componentRef.setInput("disabled", true);
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector("label") as HTMLLabelElement;
    const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;

    expect(label.className).toContain("cog-text-field--disabled");
    expect(input.disabled).toBe(true);
  });

  it("falls back to the placeholder for aria-label when no aria-label is provided", () => {
    const fixture = TestBed.createComponent(CognosTextFieldComponent);
    fixture.componentRef.setInput("placeholder", "Search…");
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBe("Search…");
  });

  it("prefers the explicit aria-label over the placeholder", () => {
    const fixture = TestBed.createComponent(CognosTextFieldComponent);
    fixture.componentRef.setInput("placeholder", "Search…");
    fixture.componentRef.setInput("ariaLabel", "Find messages");
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBe("Find messages");
  });
});
