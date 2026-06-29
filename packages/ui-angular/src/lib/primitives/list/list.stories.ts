import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosLozengeComponent } from '../lozenge/lozenge.component';
import { CognosListItemComponent } from './list-item.component';
import { CognosListComponent } from './list.component';

const meta: Meta = {
  title: 'Primitives/List',
  decorators: [
    moduleMetadata({
      imports: [CognosListComponent, CognosListItemComponent, CognosLozengeComponent],
    }),
  ],
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: `
      <div style="max-width:560px;">
        <cog-list>
          <cog-list-item>
            <div>
              <div style="font-weight:600;">Mac</div>
              <div style="color:var(--cog-text-subtle);font-size:13px;">Added 29 Jun 2026</div>
            </div>
            <button>Revoke</button>
          </cog-list-item>
          <cog-list-item>
            <div>
              <div style="font-weight:600;">iPhone</div>
              <div style="color:var(--cog-text-subtle);font-size:13px;">Last used yesterday</div>
            </div>
            <button>Revoke</button>
          </cog-list-item>
          <cog-list-item>
            <div>
              <div style="font-weight:600;">Windows PC</div>
              <div style="color:var(--cog-text-subtle);font-size:13px;">Added 12 May 2026</div>
            </div>
            <button>Revoke</button>
          </cog-list-item>
        </cog-list>
      </div>
    `,
  }),
};

export const WithTrailingMeta: Story = {
  render: () => ({
    template: `
      <div style="max-width:560px;">
        <cog-list>
          <cog-list-item>
            <div>
              <div style="font-weight:600;">Apertus 70B Instruct</div>
              <div style="color:var(--cog-text-subtle);font-size:13px;">Swiss open model</div>
            </div>
            <cog-lozenge tone="green">Swiss</cog-lozenge>
          </cog-list-item>
          <cog-list-item>
            <div>
              <div style="font-weight:600;">Gemma 4 31B IT</div>
              <div style="color:var(--cog-text-subtle);font-size:13px;">General-purpose chat</div>
            </div>
            <cog-lozenge tone="green">Swiss</cog-lozenge>
          </cog-list-item>
        </cog-list>
      </div>
    `,
  }),
};
