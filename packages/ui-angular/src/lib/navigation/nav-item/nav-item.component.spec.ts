import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CognosNavItemComponent } from "./nav-item.component";

describe("CognosNavItemComponent", () => {
  function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(CognosNavItemComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  it("computes inset padding from indent (12 + 16 * indent)", () => {
    const fixture = render({ label: "Item", indent: 2 });
    const button = fixture.nativeElement.querySelector(
      ".cog-nav-item",
    ) as HTMLButtonElement;

    expect(button.style.paddingInlineStart).toBe("44px");
  });

  it("clamps a negative indent to zero", () => {
    const fixture = render({ label: "Item", indent: -5 });
    const button = fixture.nativeElement.querySelector(
      ".cog-nav-item",
    ) as HTMLButtonElement;

    expect(button.style.paddingInlineStart).toBe("12px");
  });

  it("applies the selected class when selected is true", () => {
    const fixture = render({ label: "Item", selected: true });
    const button = fixture.nativeElement.querySelector(
      ".cog-nav-item",
    ) as HTMLButtonElement;

    expect(button.className).toContain("cog-nav-item--selected");
  });

  it("toggles expansion and emits expandedChange when expandable", () => {
    const fixture = render({ label: "Group", expandable: true });
    const button = fixture.nativeElement.querySelector(
      ".cog-nav-item",
    ) as HTMLButtonElement;

    const listener = vi.fn();
    fixture.componentInstance.expandedChange.subscribe(listener);

    expect(button.getAttribute("aria-expanded")).toBe("false");

    button.click();
    fixture.detectChanges();

    expect(listener).toHaveBeenLastCalledWith(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    button.click();
    fixture.detectChanges();

    expect(listener).toHaveBeenLastCalledWith(false);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("does nothing on click when not expandable", () => {
    const fixture = render({ label: "Leaf" });
    const button = fixture.nativeElement.querySelector(
      ".cog-nav-item",
    ) as HTMLButtonElement;

    const listener = vi.fn();
    fixture.componentInstance.expandedChange.subscribe(listener);

    button.click();
    fixture.detectChanges();

    expect(listener).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-expanded")).toBeNull();
  });

  it("renders the meta input verbatim when provided", () => {
    const fixture = render({ label: "Item", meta: "12 new" });
    const meta = fixture.nativeElement.querySelector(".cog-nav-item__meta");

    expect(meta?.textContent?.trim()).toBe("12 new");
  });

  it("leaves meta blank when expandable with no children and no explicit meta", () => {
    const fixture = render({ label: "Group", expandable: true });
    const meta = fixture.nativeElement.querySelector(".cog-nav-item__meta");

    expect(meta).toBeNull();
  });
});
