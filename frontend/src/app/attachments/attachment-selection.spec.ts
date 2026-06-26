import {
  SelectedAttachment,
  buildCompletionAttachmentInputs,
  hasPendingAttachments,
} from './attachment-selection';

const base: SelectedAttachment = {
  localId: 'l1',
  requestId: 'r1',
  conversationId: 'conv1',
  fileName: 'notes.txt',
  sizeBytes: 10,
  mimeType: 'text/plain',
  processorId: 'text',
  state: 'ready',
};

const record = (id: string) => ({
  id,
  conversation: 'conv1',
  message: '',
  sizeBytes: 10,
  files: ['art-0.enc'],
  data: 'manifest',
  created: '',
  updated: '',
});

describe('buildCompletionAttachmentInputs', () => {
  it('includes only ready attachments that have a record', () => {
    const selected: SelectedAttachment[] = [
      {
        ...base,
        localId: 'a',
        state: 'ready',
        record: record('rec-a'),
        textContext: 'A',
      },
      { ...base, localId: 'b', state: 'uploading' },
      { ...base, localId: 'c', state: 'ready' }, // ready but no record yet
    ];
    const out = buildCompletionAttachmentInputs(selected);
    expect(out.attachmentIds).toEqual(['rec-a']);
    expect(out.attachmentContexts).toHaveLength(1);
    expect(out.attachmentContexts[0]).toMatchObject({
      attachmentId: 'rec-a',
      displayName: 'notes.txt',
      detectedMimeType: 'text/plain',
      processorId: 'text',
      textContext: 'A',
    });
  });

  it('omits a context entry when there is no text context', () => {
    const selected: SelectedAttachment[] = [
      { ...base, record: record('rec-x'), textContext: '   ' },
    ];
    const out = buildCompletionAttachmentInputs(selected);
    expect(out.attachmentIds).toEqual(['rec-x']);
    expect(out.attachmentContexts).toHaveLength(0);
  });
});

describe('hasPendingAttachments', () => {
  it('is true while any attachment is not terminal', () => {
    expect(hasPendingAttachments([{ ...base, state: 'uploading' }])).toBe(true);
    expect(hasPendingAttachments([{ ...base, state: 'ready' }])).toBe(false);
    expect(
      hasPendingAttachments([
        { ...base, state: 'ready' },
        { ...base, state: 'failed' },
      ]),
    ).toBe(false);
  });
});
