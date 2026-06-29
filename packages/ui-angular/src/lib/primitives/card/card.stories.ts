import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosLozengeComponent } from '../lozenge/lozenge.component';
import { CognosCardComponent } from './card.component';

const meta: Meta = {
  title: 'Primitives/Card',
  decorators: [
    moduleMetadata({
      imports: [CognosCardComponent, CognosButtonComponent, CognosLozengeComponent],
    }),
  ],
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: `
      <div style="max-width:640px;">
        <cog-card heading="Password" subtitle="Your password only signs you in — it does not unlock your data.">
          <p style="margin:0;color:var(--cog-text-subtle);">Form fields go here.</p>
          <cog-button card-actions appearance="primary">Change password</cog-button>
        </cog-card>
      </div>
    `,
  }),
};

export const WithHeadingActions: Story = {
  render: () => ({
    template: `
      <div style="max-width:640px;">
        <cog-card heading="Two-factor authentication" subtitle="Require a code from an authenticator app each time you sign in.">
          <cog-lozenge card-heading-actions tone="green">Enabled</cog-lozenge>
          <p style="margin:0;color:var(--cog-text-subtle);">10 of your recovery codes remain</p>
          <div card-actions>
            <cog-button appearance="default">Regenerate</cog-button>
            <cog-button appearance="danger">Disable</cog-button>
          </div>
        </cog-card>
      </div>
    `,
  }),
};

export const Danger: Story = {
  render: () => ({
    template: `
      <div style="max-width:640px;">
        <cog-card heading="Danger zone" tone="danger">
          <p style="margin:0;color:var(--cog-text-subtle);">Irreversible actions live here.</p>
          <cog-button card-actions appearance="danger">Delete account</cog-button>
        </cog-card>
      </div>
    `,
  }),
};
