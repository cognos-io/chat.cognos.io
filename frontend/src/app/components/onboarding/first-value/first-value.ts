import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosCalloutComponent, CognosIconComponent } from '@cognos/ui-angular';

import {
  FirstValueJourney,
  FirstValueStarter,
} from '@app/services/first-value-journey';

@Component({
  selector: 'app-first-value',
  imports: [CognosCalloutComponent, CognosIconComponent, RouterLink, TranslocoModule],
  templateUrl: './first-value.html',
  styleUrl: './first-value.css',
})
export class FirstValue {
  readonly journey = inject(FirstValueJourney);
  readonly starters: readonly FirstValueStarter[] = ['think', 'draft', 'plan'];

  choose(starter: FirstValueStarter): void {
    this.journey.selectStarter(starter);
  }
}
