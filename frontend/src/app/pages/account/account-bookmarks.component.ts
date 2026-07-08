import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosBookmarkListComponent,
  CognosCardComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { SettingsPageComponent } from '@app/components/settings/settings-page.component';
import { Bookmark } from '@app/interfaces/bookmark';
import { BookmarkService } from '@app/services/bookmark.service';
import { VaultService } from '@app/services/vault.service';

// AccountBookmarksComponent is the settings page for the user's saved bookmarks:
// the highlighted spans pinned across their chats. The quote and its context are
// stored encrypted (sealed to the user's vault key) — decrypted here for review.
// Each row can jump back to the source message or be removed.
@Component({
  selector: 'app-account-bookmarks',
  standalone: true,
  imports: [
    CognosBookmarkListComponent,
    CognosCardComponent,
    SettingsPageComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <app-settings-page
        [heading]="t('settings.bookmarks.title')"
        [subtitle]="t('settings.bookmarks.description')"
      >
        <cog-card>
          <cog-bookmark-list
            [bookmarks]="items()"
            [labels]="{
              empty: t('settings.bookmarks.empty'),
              jump: t('settings.bookmarks.jump'),
              remove: t('settings.bookmarks.remove'),
            }"
            (jump)="jumpTo($event)"
            (remove)="removeById($event)"
          />
        </cog-card>
      </app-settings-page>
    </ng-container>
  `,
})
export class AccountBookmarksComponent {
  private readonly _bookmarks = inject(BookmarkService);
  private readonly _vault = inject(VaultService);
  private readonly _router = inject(Router);
  private readonly _transloco = inject(TranslocoService);
  private readonly _toast = inject(CognosToastService);

  // Guards the one-shot load so the unlock effect doesn't reload on every vault
  // state change.
  private _loaded = false;

  readonly bookmarks = this._bookmarks.all;

  // Map decrypted bookmarks to the presentational list's item shape.
  readonly items = computed(() =>
    this.bookmarks().map((bookmark) => ({
      id: bookmark.recordId,
      quote: bookmark.quote,
      note: bookmark.note,
    })),
  );

  // The page can render before the vault is unlocked (the unlock gate prompts
  // over it), so wait for the user key pair before loading and decrypting.
  private readonly _load = effect(() => {
    if (this._loaded || !this._vault.keyPair()) {
      return;
    }
    this._loaded = true;
    this._bookmarks.loadAll().subscribe({ error: () => undefined });
  });

  jumpTo(recordId: string): void {
    const bookmark = this.bookmarks().find((b) => b.recordId === recordId);
    if (bookmark) {
      this.jump(bookmark);
    }
  }

  removeById(recordId: string): void {
    const bookmark = this.bookmarks().find((b) => b.recordId === recordId);
    if (bookmark) {
      this.remove(bookmark);
    }
  }

  jump(bookmark: Bookmark): void {
    this._router.navigate(['/c', bookmark.conversationId], {
      queryParams: { m: bookmark.messageId },
    });
  }

  remove(bookmark: Bookmark): void {
    this._bookmarks
      .remove(bookmark.recordId)
      .pipe(
        catchError(() => {
          this._toast.notify({
            title: this._transloco.translate('settings.bookmarks.removeError'),
            tone: 'danger',
          });
          return EMPTY;
        }),
      )
      .subscribe(() =>
        this._toast.notify({
          title: this._transloco.translate('settings.bookmarks.removed'),
        }),
      );
  }
}
