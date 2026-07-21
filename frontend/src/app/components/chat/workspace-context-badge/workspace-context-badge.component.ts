import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosIconComponent } from '@cognos/ui-angular';

/**
 * WorkspaceContextBadgeComponent — the persistent, unambiguous billing-context
 * cue shown on the composer and Project pages once an Account holds Org
 * memberships (docs/business_processes/organisation-lifecycle.md; Nils's friction #1: he must
 * always know which context is billed).
 *
 * `orgName` set → "Billed to <org>"; null → "Personal — billed to you". The
 * HOST decides visibility (only shown when it disambiguates something);
 * attribution always follows Project scope, never the last-viewed Workspace.
 */
@Component({
  selector: 'app-workspace-context-badge',
  standalone: true,
  imports: [CognosIconComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace-context-badge.component.html',
  styleUrl: './workspace-context-badge.component.scss',
})
export class WorkspaceContextBadgeComponent {
  /** The billed Organisation's name, or null for the personal context. */
  readonly orgName = input<string | null>(null);
}
