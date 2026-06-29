import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosChoiceChipGroupComponent } from './choice-chip-group.component';

const meta: Meta = {
  title: 'Primitives/Choice chip group',
  decorators: [moduleMetadata({ imports: [CognosChoiceChipGroupComponent] })],
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    props: {
      value: 'swiss',
      opts: [
        { value: 'all', label: 'All' },
        { value: 'swiss', label: 'Swiss' },
        { value: 'eu', label: 'EU' },
        { value: 'fast', label: 'Fastest' },
      ],
    },
    template: `
      <cog-choice-chip-group
        [options]="opts"
        [value]="value"
        allowDeselect
        (valueChange)="value = $event"
      />
    `,
  }),
};
