import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosIconComponent,
  CognosMenuComponent,
  type CognosMenuItem,
} from '@cognos/ui-angular';

import { PERSONAL_WORKSPACE, WorkspaceId } from '@app/interfaces/organisation';
import { OrganisationService } from '@app/services/organisation.service';

/**
 * WorkspaceSwitcherComponent — the sidebar control that flips the active
 * Workspace between Personal and each Organisation the Account belongs to
 * (docs/specs/organisations.md §5.2). It renders nothing for accounts without
 * Org memberships, so individual users see zero change.
 *
 * Switching only updates OrganisationService signals — it never navigates or
 * reloads, which is what keeps an in-progress composer draft alive.
 */
@Component({
  selector: 'app-workspace-switcher',
  standalone: true,
  imports: [CognosIconComponent, CognosMenuComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace-switcher.component.html',
  styleUrl: './workspace-switcher.component.scss',
})
export class WorkspaceSwitcherComponent {
  private readonly _elementRef = inject(ElementRef<HTMLElement>);
  private readonly _transloco = inject(TranslocoService);

  readonly workspaces = inject(OrganisationService);

  readonly menuOpen = signal(false);

  private readonly _trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly _menuHost = viewChild<ElementRef<HTMLElement>>('menuHost');

  /** The active Workspace's display name (org name, or the Personal label). */
  readonly activeLabel = computed(() => {
    const org = this.workspaces.activeOrg();
    return org ? org.name : this._transloco.translate('workspace.personal');
  });

  // Menu entries: Personal first, then each Organisation. The subtitle keeps
  // the billing context unambiguous at the exact moment of switching.
  private readonly _entries = computed<
    { workspace: WorkspaceId; item: CognosMenuItem }[]
  >(() => {
    const active = this.workspaces.activeWorkspace();
    return [
      {
        workspace: PERSONAL_WORKSPACE,
        item: {
          title: this._transloco.translate('workspace.personal'),
          sub: this._transloco.translate('workspace.billedToYou'),
          icon: 'shield' as const,
          selected: active === PERSONAL_WORKSPACE,
        },
      },
      ...this.workspaces.memberships().map((org) => ({
        workspace: org.id as WorkspaceId,
        item: {
          title: org.name,
          sub: this._transloco.translate('workspace.billedToOrg', { name: org.name }),
          icon: 'users' as const,
          selected: active === org.id,
        },
      })),
    ];
  });

  readonly menuItems = computed<CognosMenuItem[]>(() =>
    this._entries().map((entry) => entry.item),
  );

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (!this._elementRef.nativeElement.contains(target)) {
      this.menuOpen.set(false);
    }
  }

  toggleMenu(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const open = !this.menuOpen();
    this.menuOpen.set(open);
    if (open) {
      // Move focus into the menu so keyboard users land on the first option;
      // the timeout lets the conditional menu render first.
      setTimeout(() => this.focusFirstMenuItem(), 0);
    }
  }

  // Escape anywhere inside the switcher (trigger or menu) closes the menu and
  // returns focus to the trigger. A host listener rather than a template
  // binding: the wrapper div itself is not focusable, only its children are.
  @HostListener('keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.menuOpen()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
  }

  onMenuSelect(index: number): void {
    const entry = this._entries()[index];
    this.closeMenu();
    if (!entry) {
      return;
    }
    // Signals only — no navigation — so the composer draft survives.
    this.workspaces.setActiveWorkspace(entry.workspace);
  }

  private closeMenu(): void {
    this.menuOpen.set(false);
    // Return focus to the trigger so keyboard users aren't dropped.
    this._trigger()?.nativeElement.focus();
  }

  private focusFirstMenuItem(): void {
    const first = this._menuHost()?.nativeElement.querySelector<HTMLButtonElement>(
      'button:not([disabled])',
    );
    first?.focus();
  }
}
