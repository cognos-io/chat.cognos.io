import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosTextFieldComponent } from './text-field.component';

type StoryArgs = {
  icon: 'search' | 'lock' | null;
  placeholder: string;
  value: string;
};

const meta: Meta<StoryArgs> = {
  title: 'Primitives/Text Field',
  decorators: [
    moduleMetadata({
      imports: [CognosTextFieldComponent],
    }),
  ],
  args: {
    icon: 'search',
    placeholder: 'Search chats',
    value: '',
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="width:320px;">
        <cog-text-field
          [icon]="icon"
          [placeholder]="placeholder"
          [value]="value"
        />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Empty: Story = {};

export const Prefilled: Story = {
  args: {
    value: 'Procurement policy',
  },
};
