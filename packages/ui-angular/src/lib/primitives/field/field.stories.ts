import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosTextFieldComponent } from '../text-field/text-field.component';
import { CognosFieldComponent } from './field.component';

const meta: Meta = {
  title: 'Primitives/Field',
  decorators: [
    moduleMetadata({
      imports: [CognosFieldComponent, CognosTextFieldComponent],
    }),
  ],
};

export default meta;

type Story = StoryObj;

export const WithHint: Story = {
  render: () => ({
    template: `
      <div style="max-width:420px;">
        <cog-field label="Display name" hint="Shown to your teammates.">
          <cog-text-field placeholder="Ada Lovelace" />
        </cog-field>
      </div>
    `,
  }),
};

export const WithError: Story = {
  render: () => ({
    template: `
      <div style="max-width:420px;">
        <cog-field label="Email" error="Enter a valid email address.">
          <cog-text-field type="email" size="lg" value="not-an-email" />
        </cog-field>
      </div>
    `,
  }),
};
