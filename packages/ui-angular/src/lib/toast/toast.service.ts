import { Injectable, signal } from "@angular/core";
import type { CognosIconName } from "@cognos/ui/icons";

export type CognosToastTone = "success" | "info" | "danger";

export type CognosToastAction = {
  label: string;
  onClick?: () => void;
};

export type CognosToastInput = {
  title: string;
  msg?: string;
  tone?: CognosToastTone;
  icon?: CognosIconName;
  action?: CognosToastAction;
  duration?: number;
};

export type CognosToast = Required<
  Pick<CognosToastInput, "title" | "tone" | "icon" | "duration">
> &
  Pick<CognosToastInput, "msg" | "action"> & {
    id: string;
  };

@Injectable({ providedIn: "root" })
export class CognosToastService {
  private readonly itemsState = signal<CognosToast[]>([]);
  readonly items = this.itemsState.asReadonly();

  notify(input: CognosToastInput): string {
    const toast: CognosToast = {
      id: crypto.randomUUID(),
      title: input.title,
      msg: input.msg,
      tone: input.tone ?? "success",
      icon: input.icon ?? defaultIconForTone(input.tone ?? "success"),
      action: input.action,
      duration: input.duration ?? 3400,
    };

    this.itemsState.update((items) => [...items, toast]);
    globalThis.setTimeout(() => this.dismiss(toast.id), toast.duration);

    return toast.id;
  }

  dismiss(id: string): void {
    this.itemsState.update((items) => items.filter((item) => item.id !== id));
  }

  runAction(toast: CognosToast): void {
    toast.action?.onClick?.();
    this.dismiss(toast.id);
  }
}

function defaultIconForTone(tone: CognosToastTone): CognosIconName {
  switch (tone) {
    case "danger":
      return "shield-x";
    case "info":
      return "info";
    default:
      return "shield-check";
  }
}
