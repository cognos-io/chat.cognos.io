import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosAvatarPickerComponent } from './avatar-picker.component';

const meta: Meta = {
  title: 'Primitives/Avatar picker',
  decorators: [moduleMetadata({ imports: [CognosAvatarPickerComponent] })],
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    props: { icon: 'sparkles', color: 'violet' },
    template: `
      <div style="max-width:460px;">
        <cog-avatar-picker
          [icons]="['sparkles','rocket','heart','star','bolt','leaf']"
          [selectedIcon]="icon"
          [selectedColor]="color"
          name="Ada Lovelace"
          (iconChange)="icon = $event"
          (colorChange)="color = $event"
        />
      </div>
    `,
  }),
};
