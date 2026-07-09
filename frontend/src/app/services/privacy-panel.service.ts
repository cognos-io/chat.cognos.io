import { Injectable, signal } from '@angular/core';

/**
 * Single open/close state for the unified per-chat privacy panel (the evolved
 * `cog-security-modal`). The panel is rendered once, in the chat header, but is
 * opened from two places: the header's shield button and each assistant answer's
 * hover shield action ("see details"). Sharing one root signal keeps the panel a
 * single source of truth without wiring events up and down the component tree.
 */
@Injectable({ providedIn: 'root' })
export class PrivacyPanelService {
  private readonly _open = signal(false);

  /** Whether the privacy panel is currently open. */
  readonly isOpen = this._open.asReadonly();

  open(): void {
    this._open.set(true);
  }

  close(): void {
    this._open.set(false);
  }
}
