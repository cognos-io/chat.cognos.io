import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosToastHostComponent } from '@cognos/ui-angular';

import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, CognosToastHostComponent, TranslocoModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'frontend';

  public auth = inject(AuthService);
}
