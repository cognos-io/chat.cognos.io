import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosIconButtonComponent,
  CognosIconComponent,
  CognosMenuComponent,
  CognosMenuItem,
} from '@cognos/ui-angular';

import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';
import { Conversation } from '@app/interfaces/conversation';
import { ConversationDuplicateService } from '@app/services/conversation-duplicate.service';
import { ConversationProjectActionsService } from '@app/services/conversation-project-actions.service';
import { ConversationService } from '@app/services/conversation.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

type ConversationMenuAction =
  | 'pin'
  | 'edit'
  | 'duplicate'
  | 'move-to-project'
  | 'remove-from-project'
  | 'delete';

type ConversationMenuEntry = CognosMenuItem & { action: ConversationMenuAction };

@Component({
  selector: 'app-conversation-list-item',
  standalone: true,
  imports: [
    RouterModule,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosMenuComponent,
    TranslocoModule,
  ],
  template: `
    <div class="conversation-list-item" *transloco="let t">
      <a
        class="conversation-list-item__link"
        routerLinkActive="conversation-list-item__link--active"
        [routerLink]="['/c', conversation.record.id]"
        [attr.title]="conversation.decryptedData.title"
      >
        <span class="conversation-list-item__title">
          {{ conversation.decryptedData.title }}
        </span>
      </a>

      <div class="conversation-list-item__meta">
        @if (isConversationPinned(conversation.record.id)) {
          <span class="conversation-list-item__pin">
            <cog-icon name="pin" [size]="14" tone="text-subtlest" />
          </span>
        }

        <div class="conversation-list-item__menu-wrap">
          <cog-icon-button
            name="more-horizontal"
            [title]="t('chat.list.openMenu')"
            [selected]="menuOpen()"
            (click)="toggleMenu($event)"
          />

          @if (menuOpen()) {
            <div class="conversation-list-item__menu">
              <cog-menu [items]="menuItems()" (itemSelect)="onMenuSelect($event)" />
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .conversation-list-item {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--cog-space-075);
      min-height: 40px;
    }

    .conversation-list-item__link {
      display: block;
      min-width: 0;
      border-radius: var(--cog-radius-sm);
      color: var(--cog-text);
      padding: var(--cog-space-100) var(--cog-space-150);
      text-decoration: none;
      transition: background-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .conversation-list-item__link:hover {
      background: var(--cog-surface-hover);
    }

    .conversation-list-item__link:focus-visible {
      outline: var(--cog-border-width-strong) solid var(--cog-brand);
      outline-offset: var(--cog-border-width-strong);
    }

    .conversation-list-item__link--active {
      background: var(--cog-selected-bg);
      color: var(--cog-selected-text);
      font-weight: var(--cog-fw-semibold);
    }

    .conversation-list-item__title {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .conversation-list-item__meta {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      justify-self: end;
    }

    .conversation-list-item__pin {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--cog-text-subtlest);
    }

    .conversation-list-item__menu-wrap {
      position: relative;
    }

    .conversation-list-item__menu {
      position: absolute;
      top: calc(100% + var(--cog-space-050));
      right: 0;
      z-index: 10;
    }

    @media (min-width: 768px) {
      .conversation-list-item__menu-wrap {
        opacity: 0;
        transition: opacity var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .conversation-list-item:hover .conversation-list-item__menu-wrap,
      .conversation-list-item:focus-within .conversation-list-item__menu-wrap,
      .conversation-list-item__menu-wrap:has(.cog-icon-button--selected) {
        opacity: 1;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationListItemComponent {
  @Input({ required: true }) conversation!: Conversation;

  private readonly _dialog = inject(Dialog);
  private readonly _elementRef = inject(ElementRef<HTMLElement>);
  private readonly _preferencesService = inject(UserPreferencesService);
  private readonly _conversationService = inject(ConversationService);
  private readonly _duplicateService = inject(ConversationDuplicateService);
  private readonly _projectActions = inject(ConversationProjectActionsService);
  private readonly _transloco = inject(TranslocoService);

  readonly menuOpen = signal(false);
  readonly router = inject(Router);

  private readonly _menuEntries = computed<ConversationMenuEntry[]>(() => {
    const conversationId = this.conversation.record.id;
    const isPinned = this.isConversationPinned(conversationId);
    const entries: ConversationMenuEntry[] = [
      {
        action: 'pin',
        title: isPinned
          ? this._transloco.translate('chat.list.unpin')
          : this._transloco.translate('chat.list.pin'),
        icon: 'pin',
      },
      {
        action: 'edit',
        title: this._transloco.translate('chat.list.edit'),
        icon: 'pencil',
      },
      {
        action: 'duplicate',
        title: this._transloco.translate('chat.list.duplicate'),
        icon: 'copy',
        disabled: this._duplicateService.isDuplicatingSource(conversationId),
      },
    ];

    if (this._projectActions.canMoveToProject(this.conversation)) {
      entries.push({
        action: 'move-to-project',
        title: this._transloco.translate('chat.projectActions.moveToProject'),
        icon: 'folder',
      });
    }

    if (this._projectActions.canRemoveFromProject(this.conversation)) {
      entries.push({
        action: 'remove-from-project',
        title: this._transloco.translate('chat.projectActions.removeFromProject'),
        icon: 'x',
      });
    }

    entries.push({
      action: 'delete',
      title: this._transloco.translate('chat.list.delete'),
      icon: 'x',
    });

    return entries;
  });

  readonly menuItems = computed<CognosMenuItem[]>(() =>
    this._menuEntries().map((entry) => ({
      title: entry.title,
      icon: entry.icon,
      disabled: entry.disabled,
      trailing: entry.trailing,
    })),
  );

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    if (!this._elementRef.nativeElement.contains(target)) {
      this.menuOpen.set(false);
    }
  }

  toggleMenu(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  onMenuSelect(index: number) {
    const entry = this._menuEntries()[index];
    this.menuOpen.set(false);

    if (!entry) {
      return;
    }

    switch (entry.action) {
      case 'pin':
        this.onPinUnpinConversation(this.conversation.record.id);
        break;
      case 'edit':
        this.onEditConversation(this.conversation.record.id);
        break;
      case 'duplicate':
        this.onDuplicateConversation();
        break;
      case 'move-to-project':
        this._projectActions.openMoveDialog(this.conversation);
        break;
      case 'remove-from-project':
        this._projectActions.removeFromProject(this.conversation);
        break;
      case 'delete':
        this.onDeleteConversation(this.conversation.record.id);
        break;
    }
  }

  onDuplicateConversation() {
    // Fire-and-forget: the service owns the loading dialog, toasts, and
    // navigation. It guards against concurrent duplicates of the same source.
    void this._duplicateService.duplicate(this.conversation);
  }

  onEditConversation(conversationId: string) {
    this._dialog.open(EditConversationDialogComponent, {
      ...cognosDialogOptions,
      data: { conversationId },
    });
  }

  onDeleteConversation(conversationId: string) {
    this._dialog
      .open(ConfirmationDialogComponent, {
        ...cognosDialogOptions,
        data: {
          message: this._transloco.translate('chat.list.deleteConfirm'),
        },
      })
      .closed.subscribe((result) => {
        if (result) {
          this._conversationService.deleteConversation$.next(conversationId);
          this.router.navigate(['/']);
        }
      });
  }

  isConversationPinned(conversationId: string) {
    return this._preferencesService.isConversationPinned(conversationId);
  }

  onPinUnpinConversation(conversationId: string) {
    if (this.isConversationPinned(conversationId)) {
      this._preferencesService.unpinConversation(conversationId);
    } else {
      this._preferencesService.pinConversation(conversationId);
    }
  }
}
