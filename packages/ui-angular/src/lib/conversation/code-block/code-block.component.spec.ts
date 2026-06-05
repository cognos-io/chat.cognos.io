import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CognosCodeBlockComponent } from "./code-block.component";

describe("CognosCodeBlockComponent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("copies the code and resets the copied state after 1.4s", async () => {
    const fixture = TestBed.createComponent(CognosCodeBlockComponent);
    fixture.componentRef.setInput("code", "console.log('hello')");
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
    await button.click();
    fixture.detectChanges();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("console.log('hello')");
    expect(button.textContent?.trim()).toContain("Copied");

    vi.advanceTimersByTime(1400);
    fixture.detectChanges();
    expect(button.textContent?.trim()).toContain("Copy");
  });
});
