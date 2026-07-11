import { Component, effect, input, viewChild } from '@angular/core';

import {
  type Meta,
  type StoryObj,
  applicationConfig,
  moduleMetadata,
} from '@storybook/angular';

import { ConversationImportClient } from '@app/import/conversation-import-client';
import { ConversationImportPersistence } from '@app/import/conversation-import-persistence';
import {
  type ImportFailureReason,
  type ImportPreview,
  type ImportSource,
} from '@app/import/import-types';
import { Analytics } from '@app/services/analytics/analytics';
import { NoopAnalytics } from '@app/services/analytics/noop-analytics';
import { storybookProviders } from '@app/storybook/storybook-providers';

import { ConversationImport } from './conversation-import';

const preview: ImportPreview = {
  source: 'chatgpt',
  conversations: [
    {
      sourceId: 'conversation-1',
      title: 'Planning a Swiss rail trip',
      messages: [
        {
          sourceId: 'message-1',
          parentSourceId: null,
          role: 'user',
          text: 'Help me plan a journey.',
        },
      ],
      warnings: {
        attachments: 0,
        images: 0,
        tools: 0,
        unsupported: 0,
        ambiguousBranches: 0,
      },
    },
    {
      sourceId: 'conversation-2',
      title: 'Notes for the team offsite',
      messages: [
        {
          sourceId: 'message-2',
          parentSourceId: null,
          role: 'user',
          text: 'Draft an agenda.',
        },
        {
          sourceId: 'message-3',
          parentSourceId: 'message-2',
          role: 'assistant',
          text: 'Here is a draft.',
        },
      ],
      warnings: {
        attachments: 1,
        images: 2,
        tools: 0,
        unsupported: 0,
        ambiguousBranches: 0,
      },
    },
  ],
  totals: {
    attachments: 1,
    images: 2,
    tools: 0,
    unsupported: 0,
    ambiguousBranches: 0,
    messages: 3,
  },
};

@Component({
  selector: 'app-conversation-import-story',
  imports: [ConversationImport],
  template: '<app-conversation-import />',
})
class ConversationImportStory {
  readonly source = input<ImportSource | null>(null);
  readonly stage = input<
    'idle' | 'reading' | 'validated' | 'parsed' | 'encrypting' | 'complete' | 'error'
  >('idle');
  readonly preview = input<ImportPreview | null>(null);
  readonly error = input<ImportFailureReason | null>(null);
  readonly selectAll = input(true);
  private readonly component = viewChild.required(ConversationImport);

  constructor() {
    effect(() => {
      const component = this.component();
      const imported = this.preview();

      component.source.set(this.source());
      component.stage.set(this.stage());
      component.preview.set(imported);
      component.error.set(this.error());
      component.selected.set(
        this.selectAll() && imported
          ? new Set(imported.conversations.map((_, index) => index))
          : new Set(),
      );
    });
  }
}

type ImportStage =
  | 'idle'
  | 'reading'
  | 'validated'
  | 'parsed'
  | 'encrypting'
  | 'complete'
  | 'error';

type StoryArgs = {
  source: ImportSource | null;
  stage: ImportStage;
  preview: ImportPreview | null;
  error: ImportFailureReason | null;
  selectAll: boolean;
};

const meta: Meta<StoryArgs> = {
  title: 'Onboarding/Conversation import',
  component: ConversationImportStory,
  decorators: [
    moduleMetadata({ imports: [ConversationImportStory] }),
    applicationConfig({
      providers: [
        ...storybookProviders,
        {
          provide: ConversationImportClient,
          useValue: {
            cancel: () => undefined,
            parse: () => Promise.resolve(preview),
          },
        },
        {
          provide: ConversationImportPersistence,
          useValue: { persist: () => Promise.resolve() },
        },
        { provide: Analytics, useClass: NoopAnalytics },
      ],
    }),
  ],
  parameters: { layout: 'fullscreen' },
  argTypes: {
    source: { control: 'select', options: [null, 'chatgpt', 'claude'] },
    stage: {
      control: 'select',
      options: [
        'idle',
        'reading',
        'validated',
        'parsed',
        'encrypting',
        'complete',
        'error',
      ],
    },
    error: {
      control: 'select',
      options: [
        null,
        'invalid_json',
        'unsupported_schema',
        'too_large',
        'too_deep',
        'persistence_failed',
      ],
    },
    preview: { control: 'object' },
  },
  args: {
    source: null,
    stage: 'idle',
    preview: null,
    error: null,
    selectAll: true,
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const ChooseSource: Story = {};

export const Instructions: Story = {
  args: { source: 'chatgpt' },
};

export const PreviewReady: Story = {
  args: { source: 'chatgpt', stage: 'parsed', preview },
};

export const NoConversationsSelected: Story = {
  args: { source: 'chatgpt', stage: 'parsed', preview, selectAll: false },
};

export const Processing: Story = {
  args: { source: 'claude', stage: 'reading' },
};

export const InvalidFile: Story = {
  args: { source: 'claude', stage: 'error', error: 'invalid_json' },
};
