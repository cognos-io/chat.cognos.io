import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { filterNil } from 'ngxtension/filter-nil';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { ProfilePictureComponent } from '@app/components/team/profile-picture/profile-picture.component';
import { ErrorService } from '@app/services/error.service';

import { AuthService } from '@services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    MatButtonModule,
    CognosLogoComponent,
    ProfilePictureComponent,
    LoadingIndicatorComponent,
  ],
  template: `
    <div class="flex min-h-full">
      <div
        class="flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:flex-none lg:px-20 xl:px-24"
      >
        <div class="mx-auto w-full max-w-sm lg:w-96">
          <div class="flex flex-col justify-center gap-4">
            <app-cognos-logo palette="dark" class="w-1/2"></app-cognos-logo>
            <h2 class="mt-8 text-2xl font-bold leading-9 tracking-tight text-gray-900">
              Get started with privacy first AI
            </h2>
            <button
              mat-flat-button
              class="w-full"
              color="primary"
              (click)="authService.login$.next(true)"
              [disabled]="loading()"
            >
              @if (loading()) {
                <app-loading-indicator></app-loading-indicator>
              } @else {
                Log in / Sign Up
              }
            </button>
            @if (loading()) {
              <p class="text-sm text-gray-600">
                <em>
                  A popup should open to sign-in but if not
                  <button
                    (click)="authService.login$.next(true)"
                    class="italic underline"
                  >
                    click here</button
                  >.
                </em>
              </p>
            }
            <p class="text-balance text-center text-sm text-gray-600">
              By signing up you are agreeing to our
              <a
                class="underline"
                href="https://cognos.io/privacy-policy-and-terms/"
                target="_blank"
                rel="noreferrer"
                >Privacy Policy and Terms</a
              >.
            </p>
          </div>

          <hr class="my-8" />

          <div class="flex flex-col gap-4">
            <div class="prose text-sm leading-6 text-gray-600">
              <p>Hi, I'm Ewan.</p>
              <p>
                I'm the founder and (currently) solo developer building Cognos. I'm
                passionate about startups, privacy and having an impact so I'm building
                Cognos to help others use AI in a privacy-first way.
              </p>
              <p>
                You are accessing the beta so please expect some imperfections, in
                return I'll cover the costs for now (although you can
                <a href="https://cognos.io/" target="_blank" rel="noreferrer"
                  >subscribe</a
                >
                to contribute financially).
              </p>
              <p>
                If you'd like to talk to me about it, just
                <a href="mailto:ewan@cognos.io">drop me an email</a>.
              </p>
              <p>Thank you for trusting in me<br />and happy hacking,</p>
            </div>
            <div class="size-24 lg:size-40">
              <app-profile-picture
                profileName="Ewan Jones"
                profilePicturePath="assets/img/profile/profile_ewan--square.jpg"
              ></app-profile-picture>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class LoginComponent {
  readonly authService: AuthService = inject(AuthService);
  private readonly _router: Router = inject(Router);
  private readonly _errorService: ErrorService = inject(ErrorService);

  loading = computed(() => this.authService.status() === 'authenticating');

  constructor() {
    this.authService.user$
      .pipe(
        catchError(() => {
          this._errorService.alert(
            'Failed to fetch user, please refresh and try again.',
          );
          return EMPTY;
        }),
        takeUntilDestroyed(),
        filterNil(),
      )
      .subscribe((user) => {
        if (user) {
          this._router.navigate(['/']);
        }
      });
  }
}
