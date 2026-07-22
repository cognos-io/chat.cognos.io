import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import chatgptFixture from './fixtures/chatgpt-conversations.json';
import claudeFixture from './fixtures/claude-conversations.json';
import { parseImportJson } from './import-parser';

describe('parseImportJson', () => {
  it('maps a current-shape ChatGPT fixture (linear + tool hop)', () => {
    const preview = parseImportJson('chatgpt', JSON.stringify(chatgptFixture));
    const linear = preview.conversations.find((c) =>
      c.title.includes('Synthetic planning'),
    );
    expect(linear).toBeDefined();
    expect(linear!.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'Synthetic question about a weekend itinerary' },
      { role: 'assistant', text: 'Synthetic answer with a calm itinerary outline' },
    ]);
    expect(preview.totals.tools).toBeGreaterThanOrEqual(1);
  });

  it('splits ChatGPT sibling branches from the current-shape fixture', () => {
    const preview = parseImportJson('chatgpt', JSON.stringify(chatgptFixture));
    const branches = preview.conversations.filter((c) =>
      c.title.startsWith('Synthetic research fork'),
    );
    expect(branches).toHaveLength(2);
    expect(branches.map((c) => c.title).sort()).toEqual([
      'Synthetic research fork (1)',
      'Synthetic research fork (2)',
    ]);
    expect(preview.totals.ambiguousBranches).toBeGreaterThanOrEqual(1);
  });

  it('maps a current-shape Claude fixture with text + content blocks', () => {
    const preview = parseImportJson('claude', JSON.stringify(claudeFixture));
    const linear = preview.conversations.find(
      (c) => c.title === 'Synthetic private planning',
    );
    expect(linear).toBeDefined();
    expect(linear!.messages).toHaveLength(2);
    expect(linear!.messages[0].text).toContain('SYNTHETIC-LOCAL-IMPORT-MARKER');
    expect(linear!.messages[1].text).toBe('Synthetic imported answer');
  });

  it('falls back to Claude content blocks when text is empty', () => {
    const preview = parseImportJson('claude', JSON.stringify(claudeFixture));
    const contentOnly = preview.conversations.find(
      (c) => c.title === 'Synthetic content-block conversation',
    );
    expect(contentOnly).toBeDefined();
    expect(contentOnly!.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'Content-block only question' },
      { role: 'assistant', text: 'Content-block only answer' },
    ]);
    // Thinking blocks must never surface as message text.
    expect(contentOnly!.messages[1].text).not.toContain('internal scratch');
    expect(contentOnly!.warnings.attachments).toBe(1);
  });

  it('maps a linear ChatGPT graph and excludes tool content visibly', () => {
    const preview = parseImportJson(
      'chatgpt',
      JSON.stringify([
        {
          id: 'conversation-1',
          title: 'Synthetic planning chat',
          create_time: 1_700_000_000,
          mapping: {
            root: { parent: null, message: null },
            user: {
              parent: 'root',
              message: {
                author: { role: 'user' },
                content: { content_type: 'text', parts: ['Synthetic question'] },
              },
            },
            tool: {
              parent: 'user',
              message: {
                author: { role: 'tool' },
                content: { content_type: 'text', parts: ['hidden tool output'] },
              },
            },
            assistant: {
              parent: 'tool',
              message: {
                author: { role: 'assistant' },
                content: { content_type: 'text', parts: ['Synthetic answer'] },
              },
            },
          },
        },
      ]),
    );

    expect(
      preview.conversations[0].messages.map(({ role, text }) => ({ role, text })),
    ).toEqual([
      { role: 'user', text: 'Synthetic question' },
      { role: 'assistant', text: 'Synthetic answer' },
    ]);
    expect(preview.totals.tools).toBe(1);
  });

  it('maps a Claude linear export and counts attachments', () => {
    const preview = parseImportJson(
      'claude',
      JSON.stringify([
        {
          uuid: 'conversation-1',
          name: 'Synthetic research',
          created_at: '2026-01-02T10:00:00Z',
          chat_messages: [
            { uuid: 'one', sender: 'human', text: 'Question', attachments: [{}] },
            { uuid: 'two', sender: 'assistant', text: 'Answer' },
          ],
        },
      ]),
    );

    expect(preview.totals.messages).toBe(2);
    expect(preview.totals.attachments).toBe(1);
    expect(preview.conversations[0].messages[1].parentSourceId).toBe('one');
  });

  it('always produces supported roles and backward-only parents', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.constantFrom('human', 'assistant'), fc.string({ minLength: 1 })),
          {
            maxLength: 50,
          },
        ),
        (entries) => {
          const preview = parseImportJson(
            'claude',
            JSON.stringify([
              {
                uuid: 'fixture',
                name: 'Fixture',
                chat_messages: entries.map(([sender, text], index) => ({
                  uuid: `m-${index}`,
                  sender,
                  text,
                })),
              },
            ]),
          );
          const messages = preview.conversations[0].messages;
          for (const [index, message] of messages.entries()) {
            expect(['user', 'assistant']).toContain(message.role);
            expect(message.parentSourceId).toBe(
              index === 0 ? null : messages[index - 1].sourceId,
            );
          }
        },
      ),
    );
  });

  it('does not throw an uncaught error for arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        try {
          parseImportJson('chatgpt', text);
        } catch (error) {
          expect(error).toMatchObject({ name: 'ImportParseError' });
        }
      }),
    );
  });

  it('rejects an excessive number of empty Conversations before rendering', () => {
    expect(() =>
      parseImportJson(
        'claude',
        JSON.stringify(
          Array.from({ length: 501 }, (_, index) => ({
            uuid: `conversation-${index}`,
            name: 'Synthetic',
            chat_messages: [],
          })),
        ),
      ),
    ).toThrow(expect.objectContaining({ reason: 'too_large' }));
  });
});
