import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosButtonComponent } from '../../button/button.component';
import {
  type CognosDialogActionsAlign,
  CognosDialogActionsComponent,
  type CognosDialogActionsMobile,
} from './dialog-actions.component';

type StoryArgs = {
  align: CognosDialogActionsAlign;
  mobile: CognosDialogActionsMobile;
};

const meta: Meta<StoryArgs> = {
  title: 'Overlays/Dialog actions',
  decorators: [
    moduleMetadata({
      imports: [CognosDialogActionsComponent, CognosButtonComponent],
    }),
  ],
  args: {
    align: 'end',
    mobile: 'inline',
  },
  argTypes: {
    align: { control: 'select', options: ['start', 'center', 'end', 'between'] },
    mobile: { control: 'select', options: ['inline', 'stack', 'split'] },
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="max-width: 480px; border: 1px solid var(--cog-border); border-radius: 8px; padding: 12px 16px;">
        <cog-dialog-actions [align]="align" [mobile]="mobile">
          <cog-button appearance="subtle">Cancel</cog-button>
          <cog-button appearance="primary" icon="link">Create public link</cog-button>
        </cog-dialog-actions>
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const SpaceBetween: Story = {
  args: { align: 'between' },
};
