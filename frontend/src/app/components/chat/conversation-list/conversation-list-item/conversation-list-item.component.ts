import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnDestroy,
  inject,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterModule } from '@angular/router';

import { Subject, takeUntil } from 'rxjs';

import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';
import { Conversation } from '@app/interfaces/conversation';
import { ConversationService } from '@app/services/conversation.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';

@Component({
  selector: 'app-conversation-list-item',
  standalone: true,
  imports: [
    RouterModule,
    MatTooltipModule,
    MatMenuModule,
    MatIconModule,
    CommonModule,
    MatListModule,
  ],
  template: `<a
      mat-list-item
      [routerLink]="['c', conversation.record.id]"
      class="conversation-list-item group"
      [matTooltip]="conversation.decryptedData.title"
      matTooltipPosition="after"
      matTooltipTouchGestures="off"
    >
      <p matListItemTitle>{{ conversation.decryptedData.title }}</p>
      <div
        matListItemMeta
        class="conversation-list-item-actions hidden group-hover:flex group-active:flex"
      >
        <button
          mat-icon-button
          class="actions-button"
          [matMenuTriggerFor]="menu"
          aria-label="Open conversation menu"
        >
          <mat-icon fontSet="bi" fontIcon="bi-three-dots-vertical"></mat-icon>
        </button>
      </div>
    </a>
    <mat-menu #menu="matMenu">
      <button mat-menu-item="" (click)="onPinUnpinConversation(conversation.record.id)">
        <mat-icon
          [ngClass]="{
            pinned: isConversationPinned(conversation.record.id),
          }"
          fontSet="bi"
          [fontIcon]="
            isConversationPinned(conversation.record.id)
              ? 'bi-pin-angle-fill'
              : 'bi-pin-angle'
          "
        />
        @if (isConversationPinned(conversation.record.id)) {
          Unpin
        } @else {
          Pin
        }
      </button>
      <button mat-menu-item="" (click)="onEditConversation(conversation.record.id)">
        <mat-icon fontSet="bi" fontIcon="bi-pencil-square"></mat-icon>
        Edit
      </button>
      <button mat-menu-item="" (click)="onDeleteConversation(conversation.record.id)">
        <mat-icon fontSet="bi" fontIcon="bi-trash3"></mat-icon>
        Delete
      </button>
    </mat-menu> `,
  styles: `
    @import 'include-media/dist/include-media';

    @include media('>=tablet') {
      .conversation-list-item-actions {
        opacity: 0;
      }

      .conversation-list-item {
        &:hover {
          .conversation-list-item-actions {
            opacity: 1;
          }
        }
      }
    }

    .conversation-list-item {
      transition: all 150ms ease-in;
    }

    .conversation-list-item-actions {
      flex-direction: column;

      .actions-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
    }

    mat-icon.pinned {
      @apply text-green-700;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationListItemComponent implements OnDestroy {
  @Input({ required: true }) conversation!: Conversation;

  private readonly _preferencesService = inject(UserPreferencesService);
  private readonly _destroyed$ = new Subject<void>();
  private readonly _dialogService = inject(MatDialog);
  readonly router = inject(Router);
  private readonly _conversationService = inject(ConversationService);

  ngOnDestroy(): void {
    this._destroyed$.next();
    this._destroyed$.complete();
  }

  onEditConversation(conversationId: string) {
    this._dialogService.open(EditConversationDialogComponent, {
      data: {
        conversationId,
      },
    });
  }

  onDeleteConversation(conversationId: string) {
    this._dialogService
      .open(ConfirmationDialogComponent, {
        data: {
          message: 'Are you sure you want to delete this conversation?',
        },
      })
      .afterClosed()
      .pipe(takeUntil(this._destroyed$))
      .subscribe((result: boolean) => {
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
