import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosSegmentedControlComponent } from './segmented-control.component';

const meta: Meta = {
  title: 'Primitives/Segmented control',
  decorators: [moduleMetadata({ imports: [CognosSegmentedControlComponent] })],
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    props: {
      value: 'recommended',
      opts: [
        { value: 'recommended', label: 'Recommended' },
        { value: 'newest', label: 'Newest' },
        { value: 'cost', label: 'Cost' },
        { value: 'recent', label: 'Recent' },
      ],
    },
    template: `
      <cog-segmented-control
        [options]="opts"
        [value]="value"
        ariaLabel="Sort models"
        (select)="value = $event"
      />
    `,
  }),
};

// A bidirectional segment: the "Cost" option shows a chevron that flips as the
// caller toggles between ascending and descending on repeated taps.
export const BidirectionalCost: Story = {
  render: () => ({
    props: {
      value: 'cost_asc',
      onSelect(this: { value: string }, clicked: string) {
        if (clicked === 'cost') {
          this.value = this.value === 'cost_asc' ? 'cost_desc' : 'cost_asc';
          return;
        }
        this.value = clicked;
      },
      opts() {
        const asc = (this as { value: string }).value === 'cost_asc';
        const costActive = (this as { value: string }).value.startsWith('cost');
        return [
          { value: 'recommended', label: 'Recommended' },
          {
            value: 'cost',
            label: 'Cost',
            icon: costActive ? 'chevron-down' : undefined,
            iconRotated: asc,
          },
        ];
      },
    },
    template: `
      <cog-segmented-control
        [options]="opts()"
        [value]="value.startsWith('cost') ? 'cost' : value"
        ariaLabel="Sort models"
        (select)="onSelect($event)"
      />
    `,
  }),
};
