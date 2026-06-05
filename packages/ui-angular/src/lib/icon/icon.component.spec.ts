import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { CognosIconComponent } from "./icon.component";

describe("CognosIconComponent", () => {
  it("renders an svg with the requested size class, style, and tone", () => {
    const fixture = TestBed.createComponent(CognosIconComponent);
    fixture.componentRef.setInput("name", "lock");
    fixture.componentRef.setInput("size", 20);
    fixture.componentRef.setInput("tone", "brand");
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector("svg") as SVGElement;

    expect(svg).toBeTruthy();
    expect(svg.getAttribute("class")).toContain("cog-icon--size-20");
    expect(svg.getAttribute("class")).toContain("cog-icon--tone-brand");
    expect(svg.style.getPropertyValue("--cog-icon-size")).toBe("20px");
  });

  it("accepts arbitrary positive sizes and rounds them", () => {
    const fixture = TestBed.createComponent(CognosIconComponent);
    fixture.componentRef.setInput("size", "22.4");
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector("svg") as SVGElement;

    expect(svg.getAttribute("class")).toContain("cog-icon--size-22");
    expect(svg.style.getPropertyValue("--cog-icon-size")).toBe("22px");
  });

  it("coerces invalid sizes back to 16", () => {
    const fixture = TestBed.createComponent(CognosIconComponent);
    fixture.componentRef.setInput("size", "oops");
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector("svg") as SVGElement;

    expect(svg.getAttribute("class")).toContain("cog-icon--size-16");
  });

  it("marks the svg as decorative when no title is provided", () => {
    const fixture = TestBed.createComponent(CognosIconComponent);
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector("svg") as SVGElement;

    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBe("presentation");
    expect(svg.querySelector("title")).toBeNull();
  });

  it("renders a <title> and img role when a title is provided", () => {
    const fixture = TestBed.createComponent(CognosIconComponent);
    fixture.componentRef.setInput("title", "Locked");
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector("svg") as SVGElement;
    const title = svg.querySelector("title");

    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(title?.textContent).toBe("Locked");
  });

  it("escapes special characters in the title to prevent injection", () => {
    const fixture = TestBed.createComponent(CognosIconComponent);
    fixture.componentRef.setInput("title", "<script>x</script>");
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector("svg") as SVGElement;
    const title = svg.querySelector("title");

    expect(title?.textContent).toBe("<script>x</script>");
    expect(svg.querySelector("script")).toBeNull();
  });
});
