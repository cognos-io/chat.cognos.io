import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { STORY_VAULT_FILES } from "../../extension-story-data";

import type { CognosSource } from "./sources-row.component";
import { CognosSourcesRowComponent } from "./sources-row.component";

type StoryArgs = {
  defaultOpen: boolean;
  sources: CognosSource[];
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Conversation/Sources Row",
  decorators: [moduleMetadata({ imports: [CognosSourcesRowComponent] })],
  argTypes: {
    sources: { control: "object" },
  },
  args: {
    defaultOpen: false,
    sources: [
      {
        file: STORY_VAULT_FILES[0],
        locator: "p. 4",
        quote: "The agreement requires thirty days' notice before termination.",
      },
      {
        file: STORY_VAULT_FILES[1],
        locator: "rows 18–24",
        quote: "Monthly payments were made in full during Q1.",
      },
    ],
  },
  render: (args) => ({
    props: args,
    template: `<div style="width:520px;"><cog-sources-row [sources]="sources" [defaultOpen]="defaultOpen" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Collapsed: Story = {};
export const Expanded: Story = { args: { defaultOpen: true } };
