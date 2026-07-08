import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import {
  type BookmarkListItem,
  CognosBookmarkListComponent,
} from './bookmark-list.component';

const SAMPLE: BookmarkListItem[] = [
  {
    id: '1',
    quote:
      'Simple is secure. Keep things idiomatic and prefer declarative over imperative.',
    note: 'Guiding principle for the redaction work.',
  },
  {
    id: '2',
    quote: 'Chats must be encrypted as soon as possible on the client.',
  },
  {
    id: '3',
    quote:
      'The AI model only ever sees the placeholder — never the real value that stays on this device.',
    note: 'Use in the privacy explainer.',
  },
];

const LABELS = {
  empty: 'You haven’t saved any bookmarks yet.',
  jump: 'Jump',
  remove: 'Remove',
};

const meta: Meta<CognosBookmarkListComponent> = {
  title: 'Chat/Bookmark list',
  component: CognosBookmarkListComponent,
  decorators: [moduleMetadata({ imports: [CognosBookmarkListComponent] })],
  parameters: { layout: 'padded' },
  render: (args) => ({
    props: args,
    template: `
      <div style="width:100%; max-width:720px;">
        <cog-bookmark-list [bookmarks]="bookmarks" [labels]="labels" />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<CognosBookmarkListComponent>;

export const Populated: Story = {
  args: { bookmarks: SAMPLE, labels: LABELS },
};

export const Empty: Story = {
  args: { bookmarks: [], labels: LABELS },
};
