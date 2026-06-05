import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { describe, expect, it } from "vitest";

import { CognosIconComponent } from "../../icon/icon.component";

import { CognosSectionMessageComponent } from "./section-message.component";

describe("CognosSectionMessageComponent", () => {
  function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(CognosSectionMessageComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  function readIcon(fixture: ReturnType<typeof render>) {
    const debugEl = fixture.debugElement.query(By.directive(CognosIconComponent));
    return debugEl.componentInstance as CognosIconComponent;
  }

  it("defaults to the info tone with a shield icon", () => {
    const fixture = render();
    const section = fixture.nativeElement.querySelector(
      ".cog-section-message",
    ) as HTMLElement;

    expect(section.className).toContain("cog-section-message--info");
    expect(readIcon(fixture).name()).toBe("shield");
  });

  it("switches to the shield-check icon for the success tone", () => {
    const fixture = render({ tone: "success" });
    const section = fixture.nativeElement.querySelector(
      ".cog-section-message",
    ) as HTMLElement;

    expect(section.className).toContain("cog-section-message--success");
    expect(readIcon(fixture).name()).toBe("shield-check");
    expect(readIcon(fixture).tone()).toBe("success");
  });

  it("lets an explicit icon override the tone-derived default", () => {
    const fixture = render({ icon: "sparkles" });
    expect(readIcon(fixture).name()).toBe("sparkles");
  });

  it("only renders the title block when a title is provided", () => {
    const fixture = render();
    expect(
      fixture.nativeElement.querySelector(".cog-section-message__title"),
    ).toBeNull();

    fixture.componentRef.setInput("title", "All clear");
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(".cog-section-message__title")?.textContent?.trim(),
    ).toBe("All clear");
  });
});
