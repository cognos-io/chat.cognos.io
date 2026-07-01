import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosDialogActionsComponent } from '../dialog-actions/dialog-actions.component';
import {
  CognosDialogSurfaceComponent,
  type CognosDialogSurfaceIconTone,
} from './dialog-surface.component';

type StoryArgs = {
  title: string;
  subtitle: string;
  icon: CognosIconName | null;
  iconTone: CognosDialogSurfaceIconTone;
  footer: boolean;
  dismissible: boolean;
  width: number;
};

const meta: Meta<StoryArgs> = {
  title: 'Overlays/Dialog surface',
  decorators: [
    moduleMetadata({
      imports: [
        CognosButtonComponent,
        CognosDialogActionsComponent,
        CognosDialogSurfaceComponent,
      ],
    }),
  ],
  argTypes: {
    icon: {
      control: 'select',
      options: [null, 'lock', 'shield-check', 'info', 'shield-x'],
    },
    iconTone: {
      control: 'inline-radio',
      options: ['default', 'info', 'success', 'danger'],
    },
  },
  args: {
    title: 'Share conversation',
    subtitle: 'End-to-end encrypted chat',
    icon: 'lock',
    iconTone: 'success',
    footer: true,
    dismissible: true,
    width: 480,
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-dialog-surface
        [title]="title"
        [subtitle]="subtitle"
        [icon]="icon"
        [iconTone]="iconTone"
        [footer]="footer"
        [dismissible]="dismissible"
        [width]="width"
      >
        <p style="margin:0; color:var(--cog-text-subtle);">
          Anyone with this link can open and read this conversation until you stop
          sharing.
        </p>

        <cog-dialog-actions cogDialogFooter>
          <cog-button appearance="subtle">Close</cog-button>
          <cog-button appearance="primary" icon="link">Create public link</cog-button>
        </cog-dialog-actions>
      </cog-dialog-surface>
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Danger: Story = {
  args: {
    title: 'Delete project',
    subtitle: 'This cannot be undone',
    icon: 'shield-x',
    iconTone: 'danger',
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-dialog-surface
        [title]="title"
        [subtitle]="subtitle"
        [icon]="icon"
        [iconTone]="iconTone"
        [footer]="footer"
        [dismissible]="dismissible"
        [width]="width"
      >
        <p style="margin:0; color:var(--cog-text-subtle);">
          Deleting a project permanently removes it and its conversations.
        </p>

        <cog-dialog-actions cogDialogFooter>
          <cog-button appearance="subtle">Cancel</cog-button>
          <cog-button appearance="danger" icon="shield-x">Delete</cog-button>
        </cog-dialog-actions>
      </cog-dialog-surface>
    `,
  }),
};
