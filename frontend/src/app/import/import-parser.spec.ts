import fc from 'fast-check';

import { parseImportJson } from './import-parser';

describe('parseImportJson', () => {
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
