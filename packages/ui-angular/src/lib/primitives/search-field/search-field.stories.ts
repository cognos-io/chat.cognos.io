import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosSearchFieldComponent } from './search-field.component';

const meta: Meta = {
  title: 'Primitives/Search field',
  decorators: [
    moduleMetadata({
      imports: [CognosSearchFieldComponent],
    }),
  ],
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: `
      <div style="max-width:520px;">
        <cog-search-field placeholder="Search files" />
      </div>
    `,
  }),
};
