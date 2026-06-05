import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CognosBreadcrumbsComponent } from "./breadcrumbs.component";

describe("CognosBreadcrumbsComponent", () => {
  function render(items: Array<{ label: string; current?: boolean }>) {
    const fixture = TestBed.createComponent(CognosBreadcrumbsComponent);
    fixture.componentRef.setInput("items", items);
    fixture.detectChanges();
    return fixture;
  }

  it("treats the last item as the current page by default", () => {
    const fixture = render([{ label: "Home" }, { label: "Settings" }]);
    const links = fixture.nativeElement.querySelectorAll(".cog-breadcrumbs__link");
    const current = fixture.nativeElement.querySelector(".cog-breadcrumbs__current");

    expect(links).toHaveLength(1);
    expect(links[0].textContent.trim()).toBe("Home");
    expect(current?.textContent?.trim()).toBe("Settings");
  });

  it("honours an explicit current flag on a non-last item", () => {
    const fixture = render([
      { label: "Home", current: true },
      { label: "Settings" },
    ]);
    const currents = fixture.nativeElement.querySelectorAll(".cog-breadcrumbs__current");

    expect(currents).toHaveLength(2);
    expect([...currents].map((node: Element) => node.textContent?.trim())).toEqual([
      "Home",
      "Settings",
    ]);
  });

  it("emits the selected index when a link is clicked", () => {
    const fixture = render([
      { label: "Home" },
      { label: "Workspace" },
      { label: "Now" },
    ]);
    const listener = vi.fn();
    fixture.componentInstance.itemSelect.subscribe(listener);

    const links = fixture.nativeElement.querySelectorAll(".cog-breadcrumbs__link");
    (links[1] as HTMLButtonElement).click();

    expect(listener).toHaveBeenCalledWith(1);
  });

  it("renders a separator between items but not after the last one", () => {
    const fixture = render([{ label: "A" }, { label: "B" }, { label: "C" }]);
    const separators = fixture.nativeElement.querySelectorAll(
      ".cog-breadcrumbs__separator",
    );

    expect(separators).toHaveLength(2);
  });
});
