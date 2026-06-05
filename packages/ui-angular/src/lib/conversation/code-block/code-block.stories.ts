import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosCodeBlockComponent } from "./code-block.component";

type StoryArgs = {
  code: string;
  lang: string;
  width: number;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Conversation/Code Block",
  decorators: [moduleMetadata({ imports: [CognosCodeBlockComponent] })],
  argTypes: {
    width: { control: { type: "range", min: 320, max: 640, step: 10 } },
  },
  args: {
    lang: "typescript",
    width: 480,
    code: `const notify = inject(CognosToastService);\nnotify.notify({ title: 'Saved to Vault' });`,
  },
  render: (args) => ({
    props: args,
    template: `<cog-code-block [code]="code" [lang]="lang" [width]="width" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
