import { describe, expect, it, vi } from "vitest";

import { CognosToastService } from "./toast.service";

describe("CognosToastService", () => {
  it("adds a toast with default tone metadata", () => {
    const service = new CognosToastService();
    vi.spyOn(globalThis, "setTimeout").mockReturnValue(0 as never);

    service.notify({ title: "Saved" });

    expect(service.items()).toHaveLength(1);
    expect(service.items()[0]).toMatchObject({
      title: "Saved",
      tone: "success",
      icon: "shield-check",
      duration: 3400,
    });
  });

  it("runs an action and dismisses the toast", () => {
    const service = new CognosToastService();
    vi.spyOn(globalThis, "setTimeout").mockReturnValue(0 as never);
    const action = vi.fn();

    service.notify({ title: "Link copied", action: { label: "Undo", onClick: action } });
    const toast = service.items()[0];
    service.runAction(toast);

    expect(action).toHaveBeenCalledTimes(1);
    expect(service.items()).toHaveLength(0);
  });
});
