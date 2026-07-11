import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosIconComponent } from '@cognos/ui-angular';

import { FirstValueJourney } from '@app/services/first-value-journey';

@Component({
  selector: 'app-early-habit',
  imports: [CognosIconComponent, TranslocoModule],
  templateUrl: './early-habit.html',
  styleUrl: './early-habit.css',
})
export class EarlyHabit {
  readonly journey = inject(FirstValueJourney);
  private readonly _router = inject(Router);

  startAnotherConversation(): void {
    void this._router.navigateByUrl('/');
  }
}
