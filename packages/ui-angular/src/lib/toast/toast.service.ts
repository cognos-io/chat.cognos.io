import { Injectable, signal } from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

export type CognosToastTone = 'success' | 'info' | 'danger';

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
  // Auto-dismiss delay in ms. A value <= 0 keeps the toast until the user
  // dismisses it manually (e.g. a long error message they need time to read).
  duration?: number;
};

export type CognosToast = Required<
  Pick<CognosToastInput, 'title' | 'tone' | 'icon' | 'duration'>
> &
  Pick<CognosToastInput, 'msg' | 'action'> & {
    id: string;
  };

@Injectable({ providedIn: 'root' })
export class CognosToastService {
  private readonly itemsState = signal<CognosToast[]>([]);
  readonly items = this.itemsState.asReadonly();

  notify(input: CognosToastInput): string {
    const toast: CognosToast = {
      id: createToastId(),
      title: input.title,
      msg: input.msg,
      tone: input.tone ?? 'success',
      icon: input.icon ?? defaultIconForTone(input.tone ?? 'success'),
      action: input.action,
      duration: input.duration ?? 3400,
    };

    this.itemsState.update((items) => [...items, toast]);
    // A non-positive duration means "sticky": leave it up until the user
    // dismisses it via the toast's close button.
    if (toast.duration > 0) {
      globalThis.setTimeout(() => this.dismiss(toast.id), toast.duration);
    }

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

// A toast id only needs to be unique within the page, so fall back to a random
// string when crypto.randomUUID is unavailable — it is a secure-context-only API
// and a toast must never throw (e.g. on a plain-http dev origin).
function createToastId(): string {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function defaultIconForTone(tone: CognosToastTone): CognosIconName {
  switch (tone) {
    case 'danger':
      return 'shield-x';
    case 'info':
      return 'info';
    default:
      return 'shield-check';
  }
}
