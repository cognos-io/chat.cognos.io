import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CognosComposerComponent } from "./composer.component";

describe("CognosComposerComponent", () => {
  it("emits the typed value", () => {
    const fixture = TestBed.createComponent(CognosComposerComponent);
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.valueChange.subscribe(listener);

    const textarea = fixture.nativeElement.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    textarea.value = "hi";
    textarea.dispatchEvent(new Event("input"));

    expect(listener).toHaveBeenCalledWith("hi");
  });

  it("disables the send button when either disabled or sendDisabled is true", () => {
    const fixture = TestBed.createComponent(CognosComposerComponent);
    fixture.componentRef.setInput("sendDisabled", true);
    fixture.detectChanges();

    const sendButton = [...fixture.nativeElement.querySelectorAll("cog-button button")].find(
      (node) => (node as HTMLElement).textContent?.includes("Send"),
    ) as HTMLButtonElement;

    expect(sendButton.disabled).toBe(true);
  });

  it("fires send / openModel / openPrompts / openSkills / attach from their respective controls", () => {
    const fixture = TestBed.createComponent(CognosComposerComponent);
    fixture.detectChanges();

    const sendListener = vi.fn();
    const modelListener = vi.fn();
    const promptsListener = vi.fn();
    const skillsListener = vi.fn();
    const attachListener = vi.fn();

    fixture.componentInstance.send.subscribe(sendListener);
    fixture.componentInstance.openModel.subscribe(modelListener);
    fixture.componentInstance.openPrompts.subscribe(promptsListener);
    fixture.componentInstance.openSkills.subscribe(skillsListener);
    fixture.componentInstance.attach.subscribe(attachListener);

    const allButtons = [
      ...fixture.nativeElement.querySelectorAll("button"),
    ] as HTMLButtonElement[];

    const sendButton = allButtons.find((b) => b.textContent?.includes("Send"))!;
    const modelButton = allButtons.find((b) => b.textContent?.includes("This device"))!;

    sendButton.click();
    modelButton.click();
    (
      fixture.nativeElement.querySelector(
        'cog-icon-button[title="Prompts"] button',
      ) as HTMLButtonElement
    ).click();
    (
      fixture.nativeElement.querySelector(
        'cog-icon-button[title="Skills"] button',
      ) as HTMLButtonElement
    ).click();
    (
      fixture.nativeElement.querySelector(
        'cog-icon-button[title="Attach file"] button',
      ) as HTMLButtonElement
    ).click();

    expect(sendListener).toHaveBeenCalledTimes(1);
    expect(modelListener).toHaveBeenCalledTimes(1);
    expect(promptsListener).toHaveBeenCalledTimes(1);
    expect(skillsListener).toHaveBeenCalledTimes(1);
    expect(attachListener).toHaveBeenCalledTimes(1);
  });
});
