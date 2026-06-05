import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CognosMenuComponent, type CognosMenuItem } from "./menu.component";

describe("CognosMenuComponent", () => {
  function render(items: CognosMenuItem[], label = "") {
    const fixture = TestBed.createComponent(CognosMenuComponent);
    fixture.componentRef.setInput("items", items);
    fixture.componentRef.setInput("label", label);
    fixture.detectChanges();
    return fixture;
  }

  it("renders one menuitem per item with the title", () => {
    const fixture = render([{ title: "One" }, { title: "Two" }]);
    const items = fixture.nativeElement.querySelectorAll('[role="menuitem"]');

    expect(items).toHaveLength(2);
    expect(items[0].querySelector(".cog-menu__title")?.textContent?.trim()).toBe("One");
  });

  it("applies the selected modifier and renders a checkmark when no trailing text is set", () => {
    const fixture = render([{ title: "Selected", selected: true }]);
    const button = fixture.nativeElement.querySelector(
      '[role="menuitem"]',
    ) as HTMLButtonElement;
    const trailing = button.querySelector(".cog-menu__trailing");

    expect(button.className).toContain("cog-menu__item--selected");
    expect(trailing?.querySelector("cog-icon")).toBeTruthy();
  });

  it("prefers explicit trailing text over the selected checkmark", () => {
    const fixture = render([{ title: "Item", selected: true, trailing: "⌘K" }]);
    const trailing = fixture.nativeElement.querySelector(".cog-menu__trailing");

    expect(trailing?.textContent?.trim()).toBe("⌘K");
    expect(trailing?.querySelector("cog-icon")).toBeNull();
  });

  it("disables the button for disabled items", () => {
    const fixture = render([{ title: "Disabled", disabled: true }]);
    const button = fixture.nativeElement.querySelector(
      '[role="menuitem"]',
    ) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it("emits the index of the clicked item", () => {
    const fixture = render([{ title: "A" }, { title: "B" }, { title: "C" }]);
    const listener = vi.fn();
    fixture.componentInstance.itemSelect.subscribe(listener);

    const items = fixture.nativeElement.querySelectorAll('[role="menuitem"]');
    (items[2] as HTMLButtonElement).click();

    expect(listener).toHaveBeenCalledWith(2);
  });

  it("only renders the section label when one is provided", () => {
    const fixture = render([{ title: "A" }]);
    expect(fixture.nativeElement.querySelector(".cog-menu__label")).toBeNull();

    fixture.componentRef.setInput("label", "Section");
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(".cog-menu__label")?.textContent?.trim(),
    ).toBe("Section");
  });
});
