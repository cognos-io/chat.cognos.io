import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { CognosLozengeComponent, CognosLozengeTone } from '@cognos/ui-angular';

import { Tag } from '@app/interfaces/tag';

@Component({
  selector: 'app-tag',
  standalone: true,
  imports: [CognosLozengeComponent],
  template: `
    <cog-lozenge [tone]="tone">
      {{ tag.title }}
    </cog-lozenge>
  `,
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagComponent {
  @Input({ required: true }) tag!: Tag;

  get tone(): CognosLozengeTone {
    return this.tag.color?.palette === 'primary' ? 'green' : 'neutral';
  }
}
