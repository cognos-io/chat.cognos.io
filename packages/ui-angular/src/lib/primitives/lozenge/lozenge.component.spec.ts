import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { CognosLozengeComponent } from "./lozenge.component";

describe("CognosLozengeComponent", () => {
  it("defaults to the neutral tone", () => {
    const fixture = TestBed.createComponent(CognosLozengeComponent);
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector("span") as HTMLSpanElement;

    expect(span.className).toContain("cog-lozenge--neutral");
  });

  it("applies the configured tone class", () => {
    const fixture = TestBed.createComponent(CognosLozengeComponent);
    fixture.componentRef.setInput("tone", "red");
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector("span") as HTMLSpanElement;

    expect(span.className).toContain("cog-lozenge--red");
  });
});
