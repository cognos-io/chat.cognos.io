import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';

const AUDIO_BARS = [
  6, 11, 18, 9, 22, 14, 26, 17, 9, 20, 28, 13, 7, 19, 24, 11, 16, 8, 21, 14, 10, 23, 17,
  9, 13, 7,
];

@Component({
  selector: 'cog-audio-note',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-audio-note" [style.width.px]="width()">
      <audio
        #player
        [src]="src() || null"
        (ended)="onEnded()"
        (loadedmetadata)="onLoadedMetadata()"
        (timeupdate)="onTimeUpdate()"
      ></audio>

      <button
        class="cog-audio-note__toggle"
        type="button"
        [attr.aria-label]="playing() ? 'Pause audio note' : 'Play audio note'"
        (click)="togglePlayback()"
      >
        <cog-icon [name]="playing() ? 'pause' : 'play'" [size]="16" tone="current" />
      </button>

      <div class="cog-audio-note__waveform" aria-hidden="true">
        @for (bar of bars; track $index; let index = $index) {
          <span
            class="cog-audio-note__bar"
            [class.cog-audio-note__bar--played]="index < playedBars()"
            [style.height.px]="bar"
          ></span>
        }
      </div>

      <div class="cog-audio-note__meta">
        <span class="cog-audio-note__duration">{{ resolvedDuration() }}</span>
        <cog-icon name="lock" [size]="11" tone="success" />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-audio-note {
        display: flex;
        width: min(100%, 280px);
        max-width: 100%;
        align-items: center;
        gap: var(--cog-space-150);
        box-sizing: border-box;
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        padding: 9px var(--cog-space-150) 9px 9px;
      }

      .cog-audio-note__toggle {
        display: inline-flex;
        width: 36px;
        height: 36px;
        flex: none;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--cog-radius-pill);
        background: var(--cog-brand);
        color: var(--cog-on-brand);
        cursor: pointer;

        &:focus-visible {
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: var(--cog-border-width-strong);
        }
      }

      .cog-audio-note__waveform {
        display: flex;
        height: 30px;
        flex: 1;
        align-items: center;
        gap: var(--cog-space-025);
      }

      .cog-audio-note__bar {
        min-width: 2px;
        flex: 1;
        border-radius: var(--cog-radius-pill);
        background: var(--cog-border-bold);
        opacity: 0.7;
      }

      .cog-audio-note__bar--played {
        background: var(--cog-brand);
        opacity: 1;
      }

      .cog-audio-note__meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 3px;
      }

      .cog-audio-note__duration {
        color: var(--cog-text-subtle);
        font-family: var(--cog-font-mono);
        font-size: 12px;
        line-height: 1.4;
      }
    `,
  ],
})
export class CognosAudioNoteComponent {
  private readonly player = viewChild<ElementRef<HTMLAudioElement>>('player');

  readonly duration = input('0:42');
  readonly src = input<string | null>(null);
  readonly width = input(280);

  protected readonly bars = AUDIO_BARS;
  protected readonly playing = signal(false);
  private readonly progressRatio = signal(0);
  private readonly measuredDuration = signal<number | null>(null);
  protected readonly playedBars = computed(() =>
    Math.round(this.bars.length * this.progressRatio()),
  );
  protected readonly resolvedDuration = computed(() => {
    const measured = this.measuredDuration();

    if (measured && Number.isFinite(measured) && measured > 0) {
      return formatDuration(measured);
    }

    return this.duration();
  });

  protected async togglePlayback(): Promise<void> {
    const player = this.player()?.nativeElement;

    if (!player || !this.src()) {
      this.playing.update((value) => !value);
      this.progressRatio.set(this.playing() ? 0.42 : 0);
      return;
    }

    if (this.playing()) {
      player.pause();
      this.playing.set(false);
      return;
    }

    await player.play();
    this.playing.set(true);
  }

  protected onLoadedMetadata(): void {
    const player = this.player()?.nativeElement;

    if (player && Number.isFinite(player.duration)) {
      this.measuredDuration.set(player.duration);
    }
  }

  protected onTimeUpdate(): void {
    const player = this.player()?.nativeElement;

    if (!player || !player.duration) {
      return;
    }

    this.progressRatio.set(player.currentTime / player.duration);
  }

  protected onEnded(): void {
    this.playing.set(false);
    this.progressRatio.set(1);
  }
}

function formatDuration(durationInSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(durationInSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
