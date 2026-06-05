import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { CognosAvatarComponent } from "./avatar.component";

describe("CognosAvatarComponent", () => {
  function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(CognosAvatarComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  it("renders initials from a multi-word name (max two letters, uppercased)", () => {
    const fixture = render({ name: "ada lovelace byron" });
    const span = fixture.nativeElement.querySelector("span") as HTMLSpanElement;

    expect(span.textContent?.trim()).toBe("AL");
  });

  it("falls back to '?' when the name is blank", () => {
    const fixture = render({ name: "   " });
    const span = fixture.nativeElement.querySelector("span") as HTMLSpanElement;

    expect(span.textContent?.trim()).toBe("?");
  });

  it("uses a generic aria-label when the name is empty", () => {
    const fixture = render();
    const span = fixture.nativeElement.querySelector("span") as HTMLSpanElement;

    expect(span.getAttribute("aria-label")).toBe("User avatar");
  });

  it("uses the name as the aria-label when provided", () => {
    const fixture = render({ name: "Grace Hopper" });
    const span = fixture.nativeElement.querySelector("span") as HTMLSpanElement;

    expect(span.getAttribute("aria-label")).toBe("Grace Hopper");
  });

  it("switches to the group icon and label when group is set", () => {
    const fixture = render({ group: true, name: "ignored" });
    const span = fixture.nativeElement.querySelector("span") as HTMLSpanElement;

    expect(span.className).toContain("cog-avatar--group");
    expect(span.getAttribute("aria-label")).toBe("Group avatar");
    expect(span.querySelector("cog-icon")).toBeTruthy();
  });

  it("coerces unsupported sizes back to 32px", () => {
    const fixture = render({ size: "999" });
    const span = fixture.nativeElement.querySelector("span") as HTMLSpanElement;

    expect(span.style.width).toBe("32px");
    expect(span.style.height).toBe("32px");
  });

  it("accepts a numeric string for size when it matches the allow list", () => {
    const fixture = render({ size: "40" });
    const span = fixture.nativeElement.querySelector("span") as HTMLSpanElement;

    expect(span.style.width).toBe("40px");
  });
});
