import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  combineLatest,
  concatMap,
  delay,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  forkJoin,
  from,
  map,
  merge,
  of,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs';

import { TranslocoService } from '@jsverse/transloco';
import { Base64 } from 'js-base64';
import { filterNil } from 'ngxtension/filter-nil';
import { signalSlice } from 'ngxtension/signal-slice';

import {
  MessageBranchInfo,
  MessageTreeAccessors,
  ROOT_PARENT_KEY,
  selectActiveBranch,
} from '@cognos/ui-angular';

import { AttachmentLibraryService } from '@app/attachments/attachment-library.service';
import { collectPathAttachmentRefs } from '@app/attachments/attachment-selection';
import { AttachmentUploadService } from '@app/attachments/attachment-upload.service';
import { AttachmentManifestV1 } from '@app/attachments/attachment.types';
import { MessageAttachmentChip } from '@app/components/chat/message-attachment-chip/message-attachment-chip.component';
import { COG_DOC_INSTRUCTION } from '@app/documents/cog-doc/cog-doc-instruction';
import { CompletionBillingRestriction } from '@app/interfaces/billing';
import { Conversation } from '@app/interfaces/conversation';
import {
  Message,
  MessageAttachment,
  MessageData,
  assertMessageBindings,
  isMessageFromUser,
  parseMessageData,
} from '@app/interfaces/message';
import {
  generateConversationPersonaId,
  generateConversationSystemPrompt,
} from '@app/interfaces/persona';
import {
  RedactionEntry,
  buildCustomCandidates,
  candidateKey,
  containsRedactionToken,
  resolveOverlaps,
} from '@app/redaction';
import { saveBlob } from '@app/utils/save-blob';
import { parseBackendDate } from '@app/utils/timestamp';

import { Analytics, modelProp } from './analytics/analytics';
import { AuthService } from './auth.service';
import { BillingService } from './billing.service';
import {
  ApiCreateCompactionRequest,
  CognosApiService,
  CompleteAttachmentContext,
  CompleteResponse,
  CompleteStreamEvent,
  CompletionMessageRequest,
  GenerateImageResponse,
  MessageListResponse,
  MessageRecord,
} from './cognos-api.service';
import {
  CompactionPlanMessage,
  CompactionService,
  estimateRawContextChars,
  planCompaction,
  renderCombinedMemory,
  shouldTriggerCompaction,
} from './compaction.service';
import { ComposerToolsService } from './composer-tools.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { ErrorService } from './error.service';
import { ModelService } from './model.service';
import { PersonaService } from './persona.service';
import { ProjectService } from './project.service';
import { RedactionService } from './redaction.service';
import { ScopedMemoryService } from './scoped-memory.service';
import { VaultService } from './vault.service';

export enum MessageStatus {
  None, // default state
  Fetching, // fetching message list
  ErrorFetching, // error state
  Decrypting, // decrypting messages
  Sending, // sending message and waiting for AI response
  ErrorSending, // error state
  LoadingMoreMessages, // loading more messages
  Success, // message sent successfully
}

interface MessageState {
  messages: Message[];
  status: MessageStatus;
  isNewConversation: boolean; // used to indicate if this is a new conversation
  currentPage: number;
  hasMoreMessages: boolean; // try to load more messages
  // branchSelections maps a parent message id to the chosen child id, so the
  // active path through a branching conversation survives regenerations. Reset
  // per-conversation; an absent/stale entry falls back to the newest sibling.
  branchSelections: Record<string, string>;
}

const initialState: MessageState = {
  messages: [],
  status: MessageStatus.None,
  isNewConversation: false,
  currentPage: 1,
  hasMoreMessages: true,
  branchSelections: {},
};

// Adapts the app's Message type to the library's generic branch resolver.
export const messageTreeAccessors: MessageTreeAccessors<Message> = {
  getId: (message) => message.record_id,
  getParentId: (message) => message.parentMessageId,
  getOrder: (message) => message.createdAt.getTime(),
};

// DELETED_MESSAGE_MARKER is the fixed, locale-independent content sent to the
// model in place of a soft-deleted message, so the model knows a turn existed
// there and was intentionally removed. The user-facing label is localised
// separately in the UI.
export const DELETED_MESSAGE_MARKER = '[message deleted]';

// buildDeletedMessageData turns a message's decrypted data into a tombstone:
// the content is dropped and a deleted flag is set, while the role, parent,
// conversation binding and timestamp are preserved so the thread structure and
// the model context marker stay correct.
export const buildDeletedMessageData = (existing: MessageData): MessageData => ({
  version: existing.version,
  content: null,
  conversation_id: existing.conversation_id,
  parent_message_id: existing.parent_message_id,
  created_at: existing.created_at,
  persona_id: existing.persona_id,
  model_id: existing.model_id,
  owner_id: existing.owner_id,
  deleted: true,
});

// regenerateContextPath returns the slice of the active path up to and
// including the parent message — the context a regenerated response replies to,
// excluding the response being replaced and anything after it.
export const regenerateContextPath = (
  activePath: ReadonlyArray<Message>,
  parentMessageId: string | undefined,
): Message[] => {
  if (!parentMessageId) {
    return [];
  }
  const parentIndex = activePath.findIndex(
    (message) => message.record_id === parentMessageId,
  );
  if (parentIndex < 0) {
    return [];
  }
  return activePath.slice(0, parentIndex + 1);
};

export type MessageRequest = {
  requestId: string;
  content: string;
  parentMessageId?: string;
  // PII redaction (spec docs/specs/pii-redaction.md). `redactionDeselected`
  // holds the offset-independent keys (see `candidateKey`) of detections the
  // user opted OUT of redacting; everything else detected is redacted by
  // default. Keys (not offsets) cross this boundary so trimming/timing can't
  // misalign them. `redactionEntries` carries the mappings minted while
  // redacting `content`, persisted once the conversation is known — it is
  // internal and never sent to the completion endpoint.
  redactionDeselected?: string[];
  // Exact substrings the user manually selected to redact in the composer.
  redactionCustom?: string[];
  redactionEntries?: RedactionEntry[];
  // When true, the request generates an image instead of a text completion.
  // Routed to the conversation image endpoint rather than /complete.
  imageGeneration?: boolean;
  // User-uploaded attachments (spec docs/specs/attachments.md). `attachmentIds`
  // are the conversation_attachments records to link to the new user message;
  // `attachmentContexts` is the transient provider context (never persisted).
  attachmentIds?: string[];
  attachmentContexts?: CompleteAttachmentContext[];
  // Redaction mappings minted over attachment text at processing time. Merged
  // into the conversation's redaction scope on send (persisted, never sent to the
  // provider). The attachmentContexts already carry the redacted text.
  attachmentRedactionEntries?: RedactionEntry[];
};

// REDACTION_INSTRUCTION tells the model to preserve placeholder tokens verbatim
// so they survive the round-trip and can be hydrated on display. It contains no
// sensitive values (spec §13).
const REDACTION_INSTRUCTION =
  'Some sensitive values in this conversation have been replaced with ' +
  'placeholders like [[PII_EMAIL_A8F2KD]]. Preserve these placeholders exactly ' +
  'in your response; do not invent, alter, or remove them.';

// composeSystemPromptSections joins the system-prompt building blocks in the
// stable order the wire contract depends on (spec
// docs/specs/document-generation.md §5.2/§6, Decision 8): project/persona
// instructions first, then the documents contract (only when the "Create
// documents" tool is on — absent entirely when it's off, so the payload stays
// byte-identical to today for opted-out conversations), then the redaction
// instruction last, unchanged from its existing position. Exported as a pure
// function so it's testable without instantiating MessageService's full
// dependency graph.
export function composeSystemPromptSections(
  instructions: string,
  personaPrompt: string,
  documentsEnabled: boolean,
  hasRedactions: boolean,
): string {
  return [
    instructions,
    personaPrompt.trim(),
    documentsEnabled ? COG_DOC_INSTRUCTION : '',
    hasRedactions ? REDACTION_INSTRUCTION : '',
  ]
    .filter((part) => part.length > 0)
    .join('\n\n');
}

type CompleteErrorBody = {
  error?: string;
  message?: string;
  next_step?: string;
};

// assertMessageBindings now lives in @app/interfaces/message so the search index
// shares the exact same binding rule. Re-exported here to keep existing imports
// (and the message.service spec) working unchanged.
export { assertMessageBindings };

// buildCompletionMessageContext walks the conversation newest-first and
// produces the chronological prompt context. It enforces the per-message
// "would push us over the input budget" stop without ever sending plaintext
// fields we did not intend to (e.g. owner_id, persona_id, model_id are only
// consulted to pick the role + display name and never round-trip into the
// outgoing payload).
export const buildCompletionMessageContext = (
  messagesNewestFirst: ReadonlyArray<Message>,
  inputContextTokens: number,
  resolvePersonaName: (id: string | undefined) => string | undefined,
  resolveModelName: (id: string | undefined) => string | undefined,
  options?: {
    // chars-per-token heuristic; defaults to the long-standing conservative 2.
    charsPerToken?: number;
    // record ids already represented by a compaction summary — skipped so they
    // are not sent raw alongside the summary (spec §9).
    excludeMessageIds?: ReadonlySet<string>;
  },
): CompletionMessageRequest[] => {
  const context: CompletionMessageRequest[] = [];
  // 1 token ~= charsPerToken characters. We avoid a tokenizer dep here
  // intentionally; the ratio is per-model (capability) with a conservative
  // default that errs towards compacting/truncating a little early.
  const charsPerToken =
    options?.charsPerToken && options.charsPerToken > 0 ? options.charsPerToken : 2;
  const excludeMessageIds = options?.excludeMessageIds;
  const targetContextChars = inputContextTokens * charsPerToken;
  let usedContextLength = 0;

  for (const message of messagesNewestFirst) {
    // Messages already folded into a compaction summary are not resent raw.
    if (message.record_id && excludeMessageIds?.has(message.record_id)) {
      continue;
    }
    // A soft-deleted message keeps its place in the thread via a marker so the
    // model sees that a turn was intentionally removed.
    const content = message.decryptedData.deleted
      ? DELETED_MESSAGE_MARKER
      : message.decryptedData.content;
    if (!content) {
      continue;
    }
    if (usedContextLength + content.length >= targetContextChars) {
      break;
    }

    const ownerId = message.decryptedData.owner_id;
    context.unshift({
      role: ownerId ? 'user' : 'assistant',
      content,
      name:
        ownerId ??
        resolvePersonaName(message.decryptedData.persona_id) ??
        resolveModelName(message.decryptedData.model_id),
    });
    usedContextLength += content.length;
  }

  return context;
};

// buildCompletionMessages is the pure assistant-append step. It returns the
// new messages array — never mutating the existing entries — so that when the
// completion response carries an expiry, the parent message is updated via a
// fresh object instead of an in-place write to a signal-held record.
export const buildCompletionMessages = (
  existing: ReadonlyArray<Message>,
  resp: CompleteResponse,
): Message[] => {
  const expires = resp.expiresAt ? parseBackendDate(resp.expiresAt) : undefined;
  const parentId = resp.assistantMessage.parentMessageId;

  const assistant: Message = {
    parentMessageId: parentId,
    record_id: resp.assistantMessage.id,
    createdAt: parseBackendDate(resp.assistantMessage.createdAt),
    expires,
    decryptedData: {
      content: resp.assistantMessage.content,
      reasoning: resp.assistantMessage.reasoning,
      persona_id: resp.assistantMessage.personaId,
      model_id: resp.assistantMessage.modelId,
      // Carry the provider's real usage so context planning uses true token
      // counts immediately, not just after a reload (spec §10.1). Mirrors what
      // the backend persists inside the encrypted blob.
      input_tokens: resp.usage.inputTokens,
      output_tokens: resp.usage.outputTokens,
    },
  };

  const next =
    expires && parentId
      ? existing.map((message) =>
          message.record_id === parentId ? { ...message, expires } : message,
        )
      : [...existing];

  next.push(assistant);
  return next;
};

export const streamingAssistantMessageId = (requestId: string): string =>
  `${requestId}:assistant`;

// reasoningDisablingEffort returns the reasoning-effort value that turns
// reasoning off for a model, or undefined when the model has no such tier (a
// non-reasoning model, where sending any effort would be rejected). Used for
// short utility completions like title generation: a reasoning model would
// otherwise spend the tiny output budget on hidden reasoning and return an
// empty title. Requesty normalises the off-tier to "off"; "none" is accepted
// as a synonym.
export const reasoningDisablingEffort = (
  reasoningEfforts: readonly string[],
): string | undefined =>
  ['off', 'none'].find((effort) => reasoningEfforts.includes(effort));

// Output budget for title generation. A title is a few words, so the budget is
// tiny. When the model always reasons (no off tier), the backend raises the
// ceiling above the thinking budget it sizes — see the reasoning-output-budget
// business process — so this tiny value is always safe to send.
export const TITLE_MAX_OUTPUT_TOKENS = 15;

// Title generation only needs the start of the first message to infer the
// user's goal; cap input so long pastes do not inflate latency or cost.
export const TITLE_INPUT_MAX_CHARS = 250;

export const TITLE_GENERATION_USER_MESSAGE_PREFIX = 'Title this message:\n\n';

export const buildTitleGenerationUserMessage = (startingMessage: string): string => {
  const trimmed = startingMessage.trim();
  const excerpt =
    trimmed.length > TITLE_INPUT_MAX_CHARS
      ? trimmed.slice(0, TITLE_INPUT_MAX_CHARS)
      : trimmed;
  return `${TITLE_GENERATION_USER_MESSAGE_PREFIX}${excerpt}`;
};

// Placeholder titles a conversation carries before its first message: the
// standalone flow creates lazily with NEW_CONVERSATION_TITLE, while project
// chats are created eagerly (before any message) with NEW_PROJECT_CHAT_TITLE.
// A conversation still holding one of these — or no title — has not been
// titled yet, so it's safe to auto-generate a title from the first message
// without clobbering a name the user chose.
export const NEW_CONVERSATION_TITLE = 'New Conversation';
export const NEW_PROJECT_CHAT_TITLE = 'New chat';

export const isPlaceholderConversationTitle = (title: string | undefined): boolean => {
  const trimmed = (title ?? '').trim();
  return (
    trimmed === '' ||
    trimmed === NEW_CONVERSATION_TITLE ||
    trimmed === NEW_PROJECT_CHAT_TITLE
  );
};

// titleReasoningEffort picks the reasoning effort for a title completion:
//   - the off tier when the model has one (cheapest — no hidden reasoning);
//   - otherwise the lowest declared tier, so the backend sizes an explicit
//     thinking budget and floors max_tokens above it. A model that always
//     reasons would otherwise 400 the tiny title request
//     ("max_tokens must be greater than thinking.budget_tokens");
//   - undefined for non-reasoning models, where any effort would be rejected.
export const titleReasoningEffort = (
  reasoningEfforts: readonly string[],
): string | undefined =>
  reasoningDisablingEffort(reasoningEfforts) ??
  reasoningEfforts.find((effort) => !['off', 'none'].includes(effort));

export const applyCompletionStreamDelta = (
  existing: ReadonlyArray<Message>,
  request: MessageRequest,
  delta: string,
  personaId: string,
  modelId: string,
): Message[] => {
  const assistantId = streamingAssistantMessageId(request.requestId);
  const assistantIndex = existing.findIndex(
    (message) => message.record_id === assistantId,
  );

  if (assistantIndex >= 0) {
    return existing.map((message, index) =>
      index === assistantIndex
        ? {
            ...message,
            isStreaming: true,
            decryptedData: {
              ...message.decryptedData,
              content: `${message.decryptedData.content ?? ''}${delta}`,
            },
          }
        : message,
    );
  }

  return [
    ...existing,
    {
      record_id: assistantId,
      parentMessageId: request.parentMessageId,
      createdAt: new Date(),
      isStreaming: true,
      decryptedData: {
        content: delta,
        persona_id: personaId,
        model_id: modelId,
      },
    },
  ];
};

// applyCompletionReasoningStreamDelta appends a reasoning delta to the
// streaming assistant message's `reasoning` field, kept separate from `content`
// so reasoning never leaks into the final answer. Mirrors
// applyCompletionStreamDelta, creating the placeholder message if the reasoning
// stream arrives before the first answer delta.
export const applyCompletionReasoningStreamDelta = (
  existing: ReadonlyArray<Message>,
  request: MessageRequest,
  delta: string,
  personaId: string,
  modelId: string,
): Message[] => {
  const assistantId = streamingAssistantMessageId(request.requestId);
  const assistantIndex = existing.findIndex(
    (message) => message.record_id === assistantId,
  );

  if (assistantIndex >= 0) {
    return existing.map((message, index) =>
      index === assistantIndex
        ? {
            ...message,
            isStreaming: true,
            decryptedData: {
              ...message.decryptedData,
              reasoning: `${message.decryptedData.reasoning ?? ''}${delta}`,
            },
          }
        : message,
    );
  }

  return [
    ...existing,
    {
      record_id: assistantId,
      parentMessageId: request.parentMessageId,
      createdAt: new Date(),
      isStreaming: true,
      decryptedData: {
        content: '',
        reasoning: delta,
        persona_id: personaId,
        model_id: modelId,
      },
    },
  ];
};

// applyCompletionWebSearchStreamDelta accumulates web-search metadata on the
// streaming assistant message (spec docs/specs/web-search.md §7). Citations are
// incremental — each frame carries only newly-seen sources with stable indices —
// so they are appended (deduped by URL as a guard); anchors are appended and
// deduped by (citation,start,end). `searchActivity` drives the transient
// `isSearching` flag; a late "started" after the answer has begun is ignored so
// it stays a visual no-op (Vertex Gemini emits activity after the text). Mirrors
// applyCompletionReasoningStreamDelta, creating the placeholder if a pure
// activity frame arrives first.
export const applyCompletionWebSearchStreamDelta = (
  existing: ReadonlyArray<Message>,
  request: MessageRequest,
  event: Extract<CompleteStreamEvent, { type: 'web_search' }>,
  personaId: string,
  modelId: string,
): Message[] => {
  const assistantId = streamingAssistantMessageId(request.requestId);
  const assistantIndex = existing.findIndex(
    (message) => message.record_id === assistantId,
  );

  const merge = (data: MessageData): MessageData => {
    const seenUrls = new Set((data.citations ?? []).map((citation) => citation.url));
    const nextCitations = [...(data.citations ?? [])];
    for (const citation of event.citations ?? []) {
      if (!seenUrls.has(citation.url)) {
        seenUrls.add(citation.url);
        nextCitations.push(citation);
      }
    }

    const anchorKey = (anchor: { citation: number; start: number; end: number }) =>
      `${anchor.citation}:${anchor.start}:${anchor.end}`;
    const seenAnchors = new Set((data.citation_anchors ?? []).map(anchorKey));
    const nextAnchors = [...(data.citation_anchors ?? [])];
    for (const anchor of event.anchors ?? []) {
      const key = anchorKey(anchor);
      if (!seenAnchors.has(key)) {
        seenAnchors.add(key);
        nextAnchors.push(anchor);
      }
    }

    return {
      ...data,
      ...(nextCitations.length ? { citations: nextCitations } : {}),
      ...(nextAnchors.length ? { citation_anchors: nextAnchors } : {}),
    };
  };

  // A "started" event only shows the status when nothing has been answered yet;
  // a "completed" event (or a late "started" after text) clears/ignores it.
  const resolveSearching = (content: string | null | undefined, current?: boolean) => {
    if (event.searchActivity === 'started') {
      return !content;
    }
    if (event.searchActivity === 'completed') {
      return false;
    }
    return current ?? false;
  };

  if (assistantIndex >= 0) {
    return existing.map((message, index) =>
      index === assistantIndex
        ? {
            ...message,
            isStreaming: true,
            isSearching: resolveSearching(
              message.decryptedData.content,
              message.isSearching,
            ),
            decryptedData: merge(message.decryptedData),
          }
        : message,
    );
  }

  return [
    ...existing,
    {
      record_id: assistantId,
      parentMessageId: request.parentMessageId,
      createdAt: new Date(),
      isStreaming: true,
      isSearching: resolveSearching(''),
      decryptedData: merge({
        content: '',
        persona_id: personaId,
        model_id: modelId,
      }),
    },
  ];
};

export const applyCompletionStreamResponse = (
  existing: ReadonlyArray<Message>,
  requestId: string,
  resp: CompleteResponse,
): Message[] => {
  // Citations accumulated during streaming are NOT echoed on the terminal
  // `complete` event (they live in the persisted encrypted blob for reload), so
  // carry them from the streaming placeholder onto the rebuilt assistant message
  // — otherwise the sources vanish until the next reload.
  const streaming = existing.find(
    (message) => message.record_id === streamingAssistantMessageId(requestId),
  );
  const citations = streaming?.decryptedData.citations;
  const citationAnchors = streaming?.decryptedData.citation_anchors;

  const messages = existing
    .filter((message) => message.record_id !== streamingAssistantMessageId(requestId))
    .map((message) =>
      resp.userMessageId && message.record_id === requestId
        ? { ...message, record_id: resp.userMessageId }
        : message,
    );

  const built = buildCompletionMessages(messages, resp);

  if (!citations?.length && !citationAnchors?.length) {
    return built;
  }

  return built.map((message) =>
    message.record_id === resp.assistantMessage.id
      ? {
          ...message,
          decryptedData: {
            ...message.decryptedData,
            ...(citations?.length ? { citations } : {}),
            ...(citationAnchors?.length ? { citation_anchors: citationAnchors } : {}),
          },
        }
      : message,
  );
};

// applyImageGenerationResponse swaps the optimistic user message's temporary id
// for the persisted one and appends the generated-image assistant message,
// carrying the decrypted image object URL for display. Pure — returns a new
// array without mutating existing entries.
export const applyImageGenerationResponse = (
  existing: ReadonlyArray<Message>,
  requestId: string,
  resp: GenerateImageResponse,
  attachment: MessageAttachment,
  imageUrl: string,
): Message[] => {
  // Swap the optimistic user message's temporary id for the persisted one (only
  // present on first generation; regenerate creates no user message).
  const messages = resp.user_message_id
    ? existing.map((message) =>
        message.record_id === requestId
          ? { ...message, record_id: resp.user_message_id }
          : message,
      )
    : [...existing];

  const assistant: Message = {
    record_id: resp.assistant_message.id,
    // Backend-authoritative parent: the new user message (generate) or the
    // existing prompt (regenerate).
    parentMessageId: resp.assistant_message.parent_message_id,
    createdAt: parseBackendDate(resp.assistant_message.created_at),
    decryptedData: {
      content: '',
      model_id: resp.assistant_message.model_id,
      attachments: [attachment],
    },
    imageUrls: [imageUrl],
  };

  return [...messages, assistant];
};

export const removeStreamingCompletionMessages = (
  existing: ReadonlyArray<Message>,
  requestId: string,
): Message[] => {
  const assistantId = streamingAssistantMessageId(requestId);
  return existing.filter(
    (message) => message.record_id !== requestId && message.record_id !== assistantId,
  );
};

// removeStreamingAssistantMessage drops only the optimistic assistant reply and
// keeps the user's turn in the thread. Used on a retryable mid-stream failure so
// the user's message isn't silently deleted and can be re-sent.
export const removeStreamingAssistantMessage = (
  existing: ReadonlyArray<Message>,
  requestId: string,
): Message[] => {
  const assistantId = streamingAssistantMessageId(requestId);
  return existing.filter((message) => message.record_id !== assistantId);
};

// CompletionErrorCopy is either a localisation key (translated at the call site
// that has TranslocoService) or a literal string the backend controls and we
// pass through verbatim (a 402 body.message). Keeping the pure resolver free of
// TranslocoService means it stays trivially unit-testable.
export type CompletionErrorCopy =
  | { kind: 'key'; key: string }
  | { kind: 'literal'; value: string };

export const resolveCompletionErrorMessage = (
  error: HttpErrorResponse,
): CompletionErrorCopy => {
  switch (error.status) {
    case 402: {
      const body = error.error as CompleteErrorBody | null;
      if (typeof body?.message === 'string' && body.message.trim() !== '') {
        // Backend-authored billing copy — pass through so it stays authoritative.
        return { kind: 'literal', value: body.message };
      }
      return { kind: 'key', key: 'chat.errors.completion.needPlan' };
    }
    case 429:
      return { kind: 'key', key: 'chat.errors.completion.rateLimited' };
    default:
      return { kind: 'key', key: 'chat.errors.completion.generic' };
  }
};

// isEmailNotVerifiedError recognises the 403 the AI-consuming endpoints return
// when the user's email is still unverified (mirrors the billing restriction
// shape). The caller surfaces a calm locked-composer state rather than a toast.
export const isEmailNotVerifiedError = (error: unknown): boolean => {
  if (!(error instanceof HttpErrorResponse) || error.status !== 403) {
    return false;
  }
  const body = error.error as { error?: string } | null;
  return body?.error === 'EMAIL_NOT_VERIFIED';
};

// parseCompletionBillingRestriction recognises the structured 402 the
// /complete endpoint returns when billing blocks a send (spec §12.7). It
// returns null for any other error so the caller falls back to a toast.
//
// The backend billing service (backend/internal/billing/service.go
// EvaluateAccess) only emits two codes: INACTIVE and TRIAL_EXHAUSTED. PAYG has
// no separate "exhausted" code — it accrues overage and is billed, and a lapsed
// PAYG subscription surfaces here as INACTIVE — so both are handled already and
// PAYG users get the same calm locked-composer state rather than a raw toast.
export const parseCompletionBillingRestriction = (
  error: unknown,
): CompletionBillingRestriction | null => {
  if (!(error instanceof HttpErrorResponse) || error.status !== 402) {
    return null;
  }
  const body = error.error as {
    error?: string;
    message?: string;
    balance_chf?: number;
    estimated_cost_chf?: number;
    next_step?: string;
  } | null;
  const code = body?.error;
  if (code !== 'TRIAL_EXHAUSTED' && code !== 'INACTIVE') {
    return null;
  }
  return {
    code,
    message:
      typeof body?.message === 'string' && body.message.trim() !== ''
        ? body.message
        : 'Your account needs an active plan before you can keep chatting.',
    balanceChf: body?.balance_chf,
    estimatedCostChf: body?.estimated_cost_chf,
    nextStep: body?.next_step,
  };
};

export const resolveCompletionFailureMessage = (
  error: unknown,
): CompletionErrorCopy => {
  if (error instanceof HttpErrorResponse) {
    return resolveCompletionErrorMessage(error);
  }
  if (error instanceof Error && error.message.trim() !== '') {
    return { kind: 'literal', value: error.message };
  }
  return { kind: 'key', key: 'chat.errors.completion.generic' };
};

// completionFailureReason maps a completion failure onto the closed
// `message_failed.reason` analytics enum (docs/specs/product-analytics.md
// §7.2). Conservative on purpose: only clearly-attributable failures get a
// specific reason; everything ambiguous is 'other'. Never carries the error
// payload.
export const completionFailureReason = (
  error: unknown,
): 'rate_limited' | 'provider_error' | 'balance' | 'other' => {
  if (parseCompletionBillingRestriction(error)) {
    return 'balance';
  }
  if (error instanceof HttpErrorResponse) {
    if (error.status === 429) {
      return 'rate_limited';
    }
    if (error.status >= 500) {
      return 'provider_error';
    }
  }
  return 'other';
};

// reasoningEffortProp maps the model's effort tier onto the closed
// `message_sent.reasoning` analytics enum. '' (model takes none) and any
// unrecognised tier report as 'none'.
export const reasoningEffortProp = (
  effort: string | undefined,
): 'none' | 'low' | 'medium' | 'high' =>
  effort === 'low' || effort === 'medium' || effort === 'high' ? effort : 'none';

export const isCompletionAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return error instanceof Error && error.name === 'AbortError';
};

export const splitStreamDeltaForDisplay = (delta: string, chunkSize = 3): string[] => {
  const chars = Array.from(delta);
  if (chars.length <= chunkSize) {
    return [delta];
  }

  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += chunkSize) {
    chunks.push(chars.slice(index, index + chunkSize).join(''));
  }
  return chunks;
};

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly _softDeleteMessage$ = new Subject<Message>();
  private readonly _personaService = inject(PersonaService);
  private readonly _authService = inject(AuthService);
  private readonly _billingService = inject(BillingService);
  private readonly _conversationService = inject(ConversationService);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _errorService = inject(ErrorService);
  private readonly _modelService = inject(ModelService);
  private readonly _composerTools = inject(ComposerToolsService);
  private readonly _api = inject(CognosApiService);
  private readonly _vaultService = inject(VaultService);
  private readonly _uploadService = inject(AttachmentUploadService);
  private readonly _attachmentLibrary = inject(AttachmentLibraryService);
  private readonly _redactionService = inject(RedactionService);
  private readonly _projectService = inject(ProjectService);
  private readonly _compactionService = inject(CompactionService);
  private readonly _scopedMemory = inject(ScopedMemoryService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _analytics = inject(Analytics);

  // Retry-after-failure state. On a retryable mid-stream failure we keep the
  // user's message in the thread and remember the (already-redacted) request so
  // an inline "Retry" affordance can re-send it without re-typing or re-redacting.
  private _failedRequest: MessageRequest | null = null;
  private readonly _sendFailed = signal(false);
  readonly sendFailed = this._sendFailed.asReadonly();
  // Feeds already-redacted requests straight into the send pipeline (bypassing
  // the redaction step), so a retry reuses the exact original request.
  private readonly _resend$ = new Subject<MessageRequest>();

  private _activeCompletionAbort: AbortController | null = null;
  private _activeCompletionRequestId = '';
  private _intentionalCompletionAbort = false;
  // Conversation ids with a compaction request currently in flight, so we keep
  // at most one per conversation (spec §10.2).
  private readonly _compactionInFlight = new Set<string>();

  private readonly pageSize = 100;

  // sources
  public readonly sendMessage$ = new Subject<MessageRequest>();
  public readonly regenerateMessage$ = new Subject<Message>();
  public readonly editMessage$ = new Subject<{ message: Message; content: string }>();
  private readonly _cleanedMessage$ = this.sendMessage$.pipe(
    map((raw) => ({ ...raw, content: raw.content?.trim() })),
    filter(({ content }) => content !== undefined && content !== ''),
    // Redact BEFORE the optimistic message is added and the context is built,
    // so neither the displayed turn nor the completion request ever holds the
    // raw value. Hydration restores it on render for the owner.
    map((req) => this.redactRequest(req as MessageRequest)),
  );
  private readonly _isNewConversation$ = new Subject<boolean>();

  // state
  private readonly state = signalSlice({
    initialState,
    sources: [
      // Clear messages when the vault is cleared or the user logs out
      this._vaultService.keyPair$.pipe(
        map((keyPair) => {
          if (keyPair) {
            return {};
          }

          return initialState;
        }),
      ),
      this._authService.logout$.pipe(
        map(() => {
          return initialState;
        }),
      ),

      this._isNewConversation$.pipe(
        map((isNewConversation) => {
          return {
            isNewConversation,
          };
        }),
      ),
      // messages need a key pair, and a conversation
      // when the conversation changes, load the messages from the backend
      (state) =>
        this._conversationService.conversation$.pipe(
          // Only react when the *selected conversation* changes — not on every
          // record mutation. A title PATCH (or any in-place record update)
          // swaps the conversation object and would otherwise re-emit here,
          // aborting the live /complete stream of the first message and
          // reloading messages mid-turn. Gate on the id so we load + abort only
          // on a genuine conversation switch.
          distinctUntilChanged((a, b) => a?.record.id === b?.record.id),
          switchMap((conversation) => {
            this.abortActiveCompletion();
            // A conversation switch clears any pending retry affordance so the
            // banner never leaks onto a different thread.
            this._failedRequest = null;
            this._sendFailed.set(false);

            if (!conversation) {
              return of(initialState);
            }
            if (state().isNewConversation) {
              // we don't need to load new messages if this is a new conversation
              return of({
                currentPage: 1,
                hasMoreMessages: true,
              });
            }

            this.state.resetState();

            const currentPage = 1;
            return this.loadMessages(conversation.record.id, currentPage).pipe(
              catchError(() => {
                this.state.setStatus(MessageStatus.ErrorFetching);
                return EMPTY;
              }),
              map((resp) => {
                const messages = resp.items;
                return {
                  ...initialState,
                  currentPage,
                  messages,
                  hasMoreMessages: resp.totalPages > currentPage,
                };
              }),
            );
          }),
        ),

      // when a message is sent, add it to the list of messages and send it to our upstream API.
      // `_resend$` re-injects an already-redacted failed request for retry.
      merge(this._cleanedMessage$, this._resend$).pipe(
        tap(() => {
          // A fresh send clears any prior failed-send retry affordance.
          this._failedRequest = null;
          this._sendFailed.set(false);
          const conversation = this._conversationService.conversation();
          if (!conversation) {
            return;
          }
          this._conversationService.updateConversationUpdatedTimeNow({
            id: conversation.record.id,
          });
        }),
        exhaustMap((messageRequest) => {
          if (!messageRequest.parentMessageId) {
            // Parent the new message to the leaf of the active branch so it
            // continues the conversation the user is currently viewing.
            const activePath = this.state.activeBranch().path;

            const lastMessage = activePath[activePath.length - 1];
            if (lastMessage) {
              messageRequest.parentMessageId = lastMessage.record_id;
            }
          }

          // Mirror the user_upload references the backend embeds, so the file
          // chip shows immediately on the optimistic message (not only on reload).
          const optimisticAttachments: MessageAttachment[] = (
            messageRequest.attachmentIds ?? []
          ).map((id) => {
            const ctx = messageRequest.attachmentContexts?.find(
              (c) => c.attachmentId === id,
            );
            return {
              kind: 'user_upload',
              attachment_id: id,
              mime_type: ctx?.detectedMimeType ?? 'application/octet-stream',
            };
          });

          const msg: Message = {
            // this ID is a temporary id and we will update it when we get the response
            record_id: messageRequest.requestId,
            parentMessageId: messageRequest.parentMessageId,
            createdAt: new Date(),
            decryptedData: {
              content: messageRequest.content,
              owner_id: this._authService.user()?.['id'],
              attachments: optimisticAttachments.length
                ? optimisticAttachments
                : undefined,
            },
          };

          // Whether the conversation had no messages before this send — the
          // signal we use to auto-title an already-existing conversation on its
          // first message (project chats are created before any message, so
          // they never hit the new-conversation branch below).
          const hadNoMessages = this.state.messages().length === 0;

          this.state.addMessage(msg);

          const conversation = this._conversationService.conversation();

          // Create a new conversation if there is no conversation selected
          // and this is not a temporary conversation
          if (!conversation && !this._conversationService.isTemporaryConversation()) {
            this._isNewConversation$.next(true);
            this._conversationService.newConversation$.next({
              title: NEW_CONVERSATION_TITLE,
            });

            return this._conversationService.conversation$.pipe(
              filterNil(),
              take(1),
              switchMap((newConversation) => {
                return combineLatest([
                  // Generate a conversation title based on the first message.
                  // Title generation (and its conversation PATCH) is best-effort:
                  // swallow any failure so it can never error the combineLatest
                  // and abort the user's in-flight answer stream.
                  this.generateAndSetConversationTitle(
                    newConversation.record,
                    messageRequest.content,
                  ).pipe(
                    startWith(newConversation),
                    catchError(() => EMPTY),
                  ),
                  // And send the message
                  this.sendMessage(messageRequest).pipe(
                    finalize(() => this._isNewConversation$.next(false)),
                  ),
                ]).pipe(map(([, state]) => state));
              }),
            );
          }

          // Re-attach the context for files referenced earlier in this thread so
          // the model keeps seeing them on follow-up turns (only the current
          // selection's ids are linked to the new message).
          const send$ = this.gatherHistoricalAttachmentContexts(
            messageRequest.attachmentIds ?? [],
          ).pipe(
            switchMap((historicalContexts) =>
              this.sendMessage(
                historicalContexts.length
                  ? {
                      ...messageRequest,
                      attachmentContexts: [
                        ...(messageRequest.attachmentContexts ?? []),
                        ...historicalContexts,
                      ],
                    }
                  : messageRequest,
              ),
            ),
          );

          // Auto-title an already-existing conversation on its first message
          // when it still carries a placeholder title. Project chats are
          // created eagerly (before any message) so they skip the branch above
          // and would otherwise stay titled "New chat". Best-effort and run
          // alongside the send, mirroring the new-conversation flow: swallow any
          // failure so it can never abort the in-flight answer stream.
          if (
            conversation &&
            hadNoMessages &&
            isPlaceholderConversationTitle(conversation.decryptedData.title)
          ) {
            return combineLatest([
              this.generateAndSetConversationTitle(
                conversation.record,
                messageRequest.content,
              ).pipe(
                startWith(null),
                catchError(() => EMPTY),
              ),
              send$,
            ]).pipe(map(([, state]) => state));
          }

          return send$;
        }),
      ),

      this._softDeleteMessage$.pipe(
        concatMap((message) => {
          return this.softDeleteMessage(message);
        }),
      ),

      // regenerate a fresh assistant response as a sibling branch
      this.regenerateMessage$.pipe(
        exhaustMap((message) => this.regenerateResponse(message)),
      ),

      // edit a user message into a new sibling branch and answer it afresh
      this.editMessage$.pipe(
        exhaustMap(({ message, content }) => this.editAndForkMessage(message, content)),
      ),
    ],
    selectors: (state) => ({
      orderedMessageList: () => {
        const messageList = [...state().messages];
        messageList.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return messageList;
      },
      reverseOrderedMessageList: () => {
        const messageList = [...state().messages];
        messageList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return messageList;
      },
      // The single linear path shown to the user plus per-fork navigation
      // metadata, resolved from the branching message set. Branch resolution
      // needs stable ids to link parents and children; temporary (non-persisted)
      // conversations have id-less assistant messages, so fall back to a plain
      // chronological list there to avoid dropping messages.
      activeBranch: (): {
        path: Message[];
        branches: Map<string, MessageBranchInfo>;
        branchPoints: Map<string, number>;
      } => {
        const messages = state().messages;
        if (!messages.every((message) => !!message.record_id)) {
          const path = [...messages].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
          return { path, branches: new Map(), branchPoints: new Map() };
        }
        return selectActiveBranch(messages, messageTreeAccessors, {
          selections: state().branchSelections,
        });
      },
    }),
    actionSources: {
      addMessage: (state, $: Observable<Message>) =>
        $.pipe(
          map((message) => {
            return {
              messages: [...state().messages, message],
            };
          }),
        ),
      nextPage: (state, $) =>
        $.pipe(
          concatMap(() => {
            if (!state().hasMoreMessages) {
              return EMPTY;
            }
            const conversation = this._conversationService.conversation();
            if (!conversation) {
              return EMPTY;
            }
            const currentPage = state().currentPage + 1;

            return this.loadMessages(conversation.record.id, currentPage).pipe(
              catchError(() => {
                this.state.setStatus(MessageStatus.ErrorFetching);
                return EMPTY;
              }),
              map((resp) => {
                const messages = resp.items;
                return {
                  currentPage,
                  status: MessageStatus.None,
                  messages: [...messages, ...state().messages],
                  hasMoreMessages: resp.totalPages > currentPage,
                };
              }),
            );
          }),
        ),
      deleteMessage: (
        state,
        $: Observable<{
          messageId: string;
          //   Delete the message and all its children (replies) (parentMessageId === messageId)
          deleteChildren: boolean;
          //   Delete the message and all its siblings (messages with the same parentMessageId and later in time)
          deleteSiblings: boolean;
        }>,
      ) =>
        $.pipe(
          map(({ messageId, deleteChildren, deleteSiblings }) => {
            let messages = state().messages;
            messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

            const messageToRemove = messages.find((msg) => msg.record_id === messageId);

            messages = messages.filter((msg) => {
              if (msg.record_id === messageId) {
                return false;
              }
              if (deleteChildren && msg.parentMessageId === messageId) {
                return false;
              }
              // Delete the message and all messages at the same level
              if (
                deleteSiblings &&
                messageToRemove &&
                msg.parentMessageId === messageToRemove.parentMessageId &&
                msg.createdAt >= messageToRemove.createdAt
              ) {
                return false;
              }
              return true;
            });
            return {
              messages,
            };
          }),
        ),
      selectBranch: (state, $: Observable<{ parentKey: string; childId: string }>) =>
        $.pipe(
          map(({ parentKey, childId }) => ({
            branchSelections: {
              ...state().branchSelections,
              [parentKey]: childId,
            },
          })),
        ),
      setStatus: (state, $: Observable<MessageStatus>) =>
        $.pipe(
          map((status) => {
            return {
              status,
            };
          }),
        ),
      resetState: (state, $: Observable<void>) =>
        $.pipe(
          map(() => {
            return initialState;
          }),
        ),
      keepExpiringMessage: (state, $: Observable<Message>) =>
        $.pipe(
          concatMap((message) => {
            return this.persistKeptExpiringMessage(message);
          }),
        ),
    },
  });

  // selectors
  // messages is the active path through the (possibly branching) conversation,
  // not the raw message set — siblings off the active branch are not shown.
  public readonly messages = computed(() => this.state.activeBranch().path);
  public readonly messages$ = toObservable(this.messages);
  public readonly branches = computed(() => this.state.activeBranch().branches);
  public readonly branchPoints = computed(() => this.state.activeBranch().branchPoints);
  public readonly status = this.state.status;
  public readonly status$ = toObservable(this.status);

  public readonly nextPage = this.state.nextPage;
  public readonly resetState = this.state.resetState;

  public deleteMessage(msg: Message) {
    if (!msg.record_id) {
      return;
    }
    this._softDeleteMessage$.next(msg);
  }

  // branchInfo returns navigation metadata for a message that sits at a fork
  // (more than one sibling), or undefined when it has none.
  public branchInfo(message: Message): MessageBranchInfo | undefined {
    return message.record_id ? this.branches().get(message.record_id) : undefined;
  }

  // branchPointCount returns how many direct children (replies/versions) a
  // message has when it is a branch point, or undefined otherwise — the `⑂ N`
  // tick in the design spec.
  public branchPointCount(message: Message): number | undefined {
    return message.record_id ? this.branchPoints().get(message.record_id) : undefined;
  }

  public previousBranch(message: Message): void {
    const info = this.branchInfo(message);
    if (info?.previousId) {
      this.state.selectBranch({ parentKey: info.parentKey, childId: info.previousId });
    }
  }

  public nextBranch(message: Message): void {
    const info = this.branchInfo(message);
    if (info?.nextId) {
      this.state.selectBranch({ parentKey: info.parentKey, childId: info.nextId });
    }
  }

  public regenerate(message: Message): void {
    this.regenerateMessage$.next(message);
  }

  // editMessage forks the conversation at a user message: the edited text is
  // sent as a new sibling of the original (same parent) and answered afresh,
  // leaving the original turn and its replies reachable via the branch switcher.
  public editMessage(message: Message, content: string): void {
    this.editMessage$.next({ message, content });
  }

  public readonly keepExpiringMessage = this.state.keepExpiringMessage;

  // helper methods
  private fetchMessages(
    conversationId: string,
    page: number,
  ): Observable<MessageListResponse> {
    if (this.state().messages.length === 0) {
      this.state.setStatus(MessageStatus.Fetching);
    } else {
      this.state.setStatus(MessageStatus.LoadingMoreMessages);
    }

    return this._api.listConversationMessages(conversationId, page, this.pageSize);
  }

  private decryptMessage(record: MessageRecord): Message {
    const base64EncryptedData = record.data;
    const conversation = this._conversationService.conversation();

    if (!conversation) {
      throw new Error('No conversation selected');
    }

    let decryptedData: Message['decryptedData'];

    try {
      decryptedData = parseMessageData(
        this._cryptoService.openSealedBox(
          Base64.toUint8Array(base64EncryptedData),
          conversation.keyPair,
        ),
      );
      assertMessageBindings(decryptedData, record);
    } catch (error) {
      // Show to the user the message failed to decrypt
      console.error('Message decryption failed', error);
      decryptedData = {
        content: this._transloco.translate('chat.message.decryptFailed'),
      };
    }

    return {
      record_id: record.id,
      // createdAt lives inside the encrypted blob (decryptedData), not a
      // plaintext record column — see MessageRecordData on the backend.
      createdAt: parseBackendDate(decryptedData.created_at),
      expires: record.expires ? parseBackendDate(record.expires) : undefined,
      parentMessageId: record.parent_message,
      decryptedData,
    };
  }

  private loadMessages(
    conversationId: string,
    page: number,
  ): Observable<{
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
    items: Message[];
  }> {
    if (page === 1) {
      // Load the conversation's encrypted compactions once, on first page, so
      // the planner can reuse them without blocking message rendering.
      this.loadCompactions(conversationId);
    }
    return this.fetchMessages(conversationId, page).pipe(
      tap(() => {
        this.state.setStatus(MessageStatus.Decrypting);
      }),
      map((response) => {
        return {
          ...response,
          items: response.items.map((record) => this.decryptMessage(record)),
        };
      }),
    );
  }

  // loadCompactions fetches and decrypts the conversation's compactions in the
  // background. Best-effort: a failure just means the planner falls back to
  // raw-tail truncation.
  private loadCompactions(conversationId: string): void {
    const conversation = this._conversationService.conversation();
    const keyPair = conversation?.keyPair;
    if (!keyPair) {
      return;
    }
    const swallow = { error: () => undefined };
    this._compactionService.load(conversationId, keyPair).subscribe(swallow);
    // User memory follows the user everywhere; project memory only when the
    // conversation belongs to a project. Both best-effort.
    this._scopedMemory.loadUserMemory().subscribe(swallow);
    const projectId = conversation?.record.project;
    if (projectId) {
      this._scopedMemory.loadProjectMemory(projectId).subscribe(swallow);
    }
  }

  // redactRequest swaps detected sensitive values in the draft for stable
  // placeholder tokens, carrying the new mappings on the request so they can be
  // persisted once the conversation exists. Pure + synchronous so the optimistic
  // message and completion context are redacted from the very first frame.
  private redactRequest(req: MessageRequest): MessageRequest {
    // Redaction is opt-out: when the user has disabled it, send as typed.
    if (!this._redactionService.enabled()) {
      return { ...req, redactionEntries: [] };
    }
    const conversationId = this._conversationService.conversation()?.record.id ?? null;
    // Re-detect on the final (already-trimmed) content and drop only what the
    // user explicitly deselected, so offsets always match the text being sent.
    const deselected = new Set(req.redactionDeselected ?? []);
    const auto = this._redactionService
      .detect(req.content)
      .filter((candidate) => !deselected.has(candidateKey(candidate)));
    // Manual selections for this message, plus values manually redacted earlier
    // in this conversation (so they keep getting redacted automatically).
    const customValues = [
      ...(req.redactionCustom ?? []),
      ...this._redactionService.customRedactionValues(conversationId),
    ];
    // Resolve overlaps so a manual selection touching a detected value doesn't
    // double-splice.
    const custom = buildCustomCandidates(req.content, customValues);
    const candidates = resolveOverlaps([...auto, ...custom]);
    const { redactedText, newEntries } = this._redactionService.prepareRedaction(
      conversationId,
      req.content,
      candidates,
      { kind: 'message', id: req.requestId },
    );

    // Attachment text is redacted at processing time and travels with the file
    // (its mappings are minted there, stable per file). Here we only merge those
    // mappings into this conversation's redaction scope so the placeholders in the
    // already-redacted attachment context hydrate (spec docs/specs/pii-redaction.md
    // §6.8). The wire attachmentContexts already carry redacted text — leave them.
    const carried: RedactionEntry[] = [
      ...newEntries,
      ...(req.attachmentRedactionEntries ?? []),
    ];

    return {
      ...req,
      content: redactedText,
      redactionEntries: carried,
    };
  }

  // persistRedaction seals and stores the mappings minted for a request. The
  // content is already redacted by the time we get here, so a failure here
  // costs the owner their own hydration — not a leak — hence it is best-effort
  // and never blocks the send. Temporary conversations have no row to attach to.
  private persistRedaction(messageRequest: MessageRequest): void {
    const conversation = this._conversationService.conversation();
    if (!conversation || !messageRequest.redactionEntries?.length) {
      return;
    }
    this._redactionService
      .persist(conversation, messageRequest.redactionEntries, {
        kind: 'message',
        id: messageRequest.requestId,
      })
      .subscribe({
        error: () => {
          // Swallow: no sensitive value was sent upstream. A retry/repair path
          // is tracked as a follow-up.
        },
      });
  }

  private sendMessage(
    messageRequest: MessageRequest,
  ): Observable<Partial<MessageState>> {
    const conversation = this._conversationService.conversation();
    const isTemporaryConversation = this._conversationService.isTemporaryConversation();

    if (!conversation && !isTemporaryConversation) {
      throw new Error('No conversation selected');
    }

    // Image generation goes to a dedicated endpoint and persists an encrypted
    // attachment, so it needs a real (non-temporary) conversation.
    if (messageRequest.imageGeneration) {
      if (!conversation || isTemporaryConversation) {
        this.reportCompletionError(
          new Error('Image generation requires a saved conversation'),
        );
        return of({
          status: MessageStatus.ErrorSending,
          messages: removeStreamingCompletionMessages(
            this.state().messages,
            messageRequest.requestId,
          ),
        });
      }
      return this.sendImageGeneration(messageRequest, conversation);
    }

    this.persistRedaction(messageRequest);

    const originConversationId = conversation?.record.id ?? null;

    this.abortActiveCompletion();
    const abortController = new AbortController();
    this._activeCompletionAbort = abortController;
    this._activeCompletionRequestId = messageRequest.requestId;

    this.state.setStatus(MessageStatus.Sending);

    const selectedPersona = this._personaService.selectedPersona();
    const { messages, contextSummary } = this.createMessageContext();
    const systemPrompt = this.composeSystemPrompt(
      selectedPersona.systemPrompt,
      conversation,
      messages,
      contextSummary,
      messageRequest.attachmentContexts,
    );
    const request = {
      messages,
      modelId: this._modelService.selectedModel().id,
      personaId: selectedPersona.id,
      systemPrompt,
      parentMessageId: messageRequest.parentMessageId,
      requestId: messageRequest.requestId,
      reasoningEffort: this._modelService.selectedReasoningEffort() || undefined,
      contextSummary,
      webSearch: this.webSearchRequestFlag(),
      attachmentIds: messageRequest.attachmentIds,
      attachmentContexts: messageRequest.attachmentContexts,
    };

    let completed = false;

    const response$ = isTemporaryConversation
      ? this._api.completeStream(request, abortController.signal)
      : this._api.completeConversationStream(
          originConversationId!,
          request,
          abortController.signal,
        );

    const shouldApplyCompletionUpdate = (): boolean => {
      if (isTemporaryConversation) {
        return this._conversationService.isTemporaryConversation();
      }
      return (
        this._conversationService.conversation()?.record.id === originConversationId
      );
    };

    // The streaming assistant placeholder is a child of the user message we just
    // added (record_id === requestId), not of the user message's parent — so the
    // active-path resolver threads it correctly while it streams.
    const streamingRequest: MessageRequest = {
      ...messageRequest,
      parentMessageId: messageRequest.requestId,
    };

    return response$.pipe(
      concatMap((event) => this.expandStreamEventForDisplay(event)),
      map((event: CompleteStreamEvent) => {
        if (!shouldApplyCompletionUpdate()) {
          return {};
        }

        switch (event.type) {
          case 'delta':
            return {
              messages: applyCompletionStreamDelta(
                this.state().messages,
                streamingRequest,
                event.delta,
                request.personaId,
                request.modelId,
              ),
            };
          case 'reasoning_delta':
            return {
              messages: applyCompletionReasoningStreamDelta(
                this.state().messages,
                streamingRequest,
                event.delta,
                request.personaId,
                request.modelId,
              ),
            };
          case 'web_search':
            return {
              messages: applyCompletionWebSearchStreamDelta(
                this.state().messages,
                streamingRequest,
                event,
                request.personaId,
                request.modelId,
              ),
            };
          case 'complete':
            completed = true;
            // Fire-and-forget: model mix / attachments / reasoning demand.
            // Enum + boolean props only — never message content.
            this._analytics.track('message_sent', {
              model: modelProp(request.modelId),
              attachments: (messageRequest.attachmentIds?.length ?? 0) > 0,
              reasoning: reasoningEffortProp(request.reasoningEffort),
            });
            return {
              status: MessageStatus.Success,
              messages: applyCompletionStreamResponse(
                this.state().messages,
                messageRequest.requestId,
                event.response,
              ),
            };
          case 'error':
            throw new Error(event.message);
        }
      }),
      catchError((err: unknown) => {
        if (this.consumeIntentionalCompletionAbort() || isCompletionAbortError(err)) {
          return EMPTY;
        }

        console.error('Error sending message');
        const handled = this.reportCompletionError(err);
        // Reason is a closed enum; the error payload never leaves the app.
        this._analytics.track('message_failed', {
          reason: completionFailureReason(err),
        });

        if (!shouldApplyCompletionUpdate()) {
          return EMPTY;
        }

        if (handled) {
          // Billing lock / email-not-verified: the locked-composer surface
          // carries the recovery path, so clear the optimistic turn entirely.
          return of({
            status: MessageStatus.ErrorSending,
            messages: removeStreamingCompletionMessages(
              this.state().messages,
              messageRequest.requestId,
            ),
          });
        }

        // Retryable failure: keep the user's message in the thread and remember
        // the request so the inline "Retry" affordance can re-send it.
        this._failedRequest = messageRequest;
        this._sendFailed.set(true);
        return of({
          status: MessageStatus.ErrorSending,
          messages: removeStreamingAssistantMessage(
            this.state().messages,
            messageRequest.requestId,
          ),
        });
      }),
      finalize(() => {
        if (this._activeCompletionAbort === abortController) {
          this._activeCompletionAbort = null;
          this._activeCompletionRequestId = '';
        }
        if (
          !completed &&
          !this._intentionalCompletionAbort &&
          shouldApplyCompletionUpdate() &&
          this.state.status() === MessageStatus.Sending
        ) {
          this.state.setStatus(MessageStatus.ErrorSending);
        }
        this.consumeIntentionalCompletionAbort();

        // After a successful persisted response, opportunistically compact the
        // older prefix in the background (spec §10). Never blocks the user.
        if (completed && !isTemporaryConversation && originConversationId) {
          this.maybeTriggerCompaction(originConversationId);
        }
      }),
    );
  }

  // decryptMessageImages fetches and decrypts a persisted message's image
  // attachments into blob object URLs. Used to hydrate images on conversation
  // load (the live generation path sets them directly). Returns [] when there's
  // nothing to decrypt.
  decryptMessageImages(message: Message): Observable<string[]> {
    const conversation = this._conversationService.conversation();
    // Only generated images carry a sealed_key + bytes on the message record.
    // User uploads live in the library (resolved via resolveAttachmentChips).
    const attachments = (message.decryptedData.attachments ?? []).filter(
      (a) => !!a.sealed_key,
    );
    if (!conversation || !message.record_id || attachments.length === 0) {
      return of([]);
    }
    const recordId = message.record_id;
    return forkJoin(
      attachments.map((attachment) =>
        this.decryptAttachmentToUrl(recordId, attachment, conversation),
      ),
    );
  }

  // sendImageGeneration runs an image request against the conversation image
  // endpoint, then decrypts the returned attachment for immediate display. It is
  // single-response (no token streaming): the optimistic user message is already
  // in state, so on success we swap its id and append the image message.
  private sendImageGeneration(
    messageRequest: MessageRequest,
    conversation: Conversation,
  ): Observable<Partial<MessageState>> {
    this.state.setStatus(MessageStatus.Sending);

    const modelId = this._modelService.selectedModel().id;

    return this._api
      .generateConversationImage(conversation.record.id, {
        prompt: messageRequest.content,
        modelId,
        requestId: messageRequest.requestId,
      })
      .pipe(
        // Image generations count as sent messages for activation/model mix.
        // They carry no user uploads and take no reasoning parameter.
        tap(() =>
          this._analytics.track('message_sent', {
            model: modelProp(modelId),
            attachments: false,
            reasoning: 'none',
          }),
        ),
        switchMap((response) =>
          this.renderImageResponse(response, conversation, messageRequest.requestId),
        ),
        catchError((err: unknown) =>
          this.handleImageError(err, messageRequest.requestId),
        ),
      );
  }

  // regenerateImage produces a fresh image as a sibling of an existing image
  // message, reusing the original prompt and parenting to the same user message
  // (no new user turn) — the image counterpart of regenerateResponse.
  private regenerateImage(
    message: Message,
    parentId: string,
    conversation: Conversation,
  ): Observable<Partial<MessageState>> {
    const prompt =
      this.state().messages.find((candidate) => candidate.record_id === parentId)
        ?.decryptedData.content ?? '';
    const modelId =
      message.decryptedData.model_id ?? this._modelService.selectedModel().id;

    this.state.setStatus(MessageStatus.Sending);

    return this._api
      .generateConversationImage(conversation.record.id, {
        prompt,
        modelId,
        parentMessageId: parentId,
        requestId: self.crypto.randomUUID(),
      })
      .pipe(
        switchMap((response) => this.renderImageResponse(response, conversation, '')),
        catchError((err: unknown) => this.handleImageError(err, '')),
      );
  }

  // renderImageResponse decrypts the generated attachment and folds the new image
  // message into state. Shared by generation and regeneration.
  private renderImageResponse(
    response: GenerateImageResponse,
    conversation: Conversation,
    requestId: string,
  ): Observable<Partial<MessageState>> {
    const attachment: MessageAttachment = {
      kind: response.assistant_message.attachment.kind,
      mime_type: response.assistant_message.attachment.mime_type,
      sealed_key: response.assistant_message.attachment.sealed_key,
      file_name: response.assistant_message.attachment.file_name,
    };
    return this.decryptAttachmentToUrl(
      response.assistant_message.id,
      attachment,
      conversation,
    ).pipe(
      map((imageUrl) => ({
        status: MessageStatus.Success,
        messages: applyImageGenerationResponse(
          this.state().messages,
          requestId,
          response,
          attachment,
          imageUrl,
        ),
      })),
    );
  }

  private handleImageError(
    err: unknown,
    requestId: string,
  ): Observable<Partial<MessageState>> {
    console.error('Error generating image');
    this.reportCompletionError(err);
    return of({
      status: MessageStatus.ErrorSending,
      messages: removeStreamingCompletionMessages(this.state().messages, requestId),
    });
  }

  // decryptAttachmentToUrl fetches the encrypted attachment file, unseals its
  // per-attachment key with the conversation key, decrypts the bytes, and
  // returns a blob object URL for display. All decryption is client-side.
  private decryptAttachmentToUrl(
    recordId: string,
    attachment: MessageAttachment,
    conversation: Conversation,
  ): Observable<string> {
    return this._api.fetchAttachmentBytes(conversation.record.id, recordId).pipe(
      map((ciphertext) => {
        // Only generated images embed a sealed_key + bytes on the message record;
        // this display path is never used for user uploads, which have none.
        if (!attachment.sealed_key) {
          throw new Error('Attachment has no sealed key');
        }
        const symmetricKey = this._cryptoService.openSealedBox(
          Base64.toUint8Array(attachment.sealed_key),
          conversation.keyPair,
        );
        const imageBytes = this._cryptoService.openSecretBox(ciphertext, symmetricKey);
        const blob = new Blob([imageBytes as BlobPart], {
          type: attachment.mime_type,
        });
        return URL.createObjectURL(blob);
      }),
    );
  }

  /**
   * Resolve the user-upload attachments on a message into chips for the bubble.
   * The state never leaks another user's filename: a viewer who is not the file
   * owner (the message sender) — including public-share viewers — gets the
   * "private" cue without any fetch. The owner resolves the library record; a
   * missing record (deleted) becomes a "removed" tombstone.
   */
  /**
   * Re-derive provider context for attachments referenced earlier in the active
   * path (excluding the current message's own selection). A stateless model
   * forgets an attachment after the turn it was sent on, so its content must be
   * re-sent on follow-up turns. Their redaction mappings are already in the
   * conversation scope, so only the (redacted) text context is rebuilt here.
   */
  private gatherHistoricalAttachmentContexts(
    currentSelectionIds: string[],
  ): Observable<CompleteAttachmentContext[]> {
    const path = this.state.activeBranch().path;
    // Skip attachments whose message is already folded into a compaction summary
    // (it's excluded from the raw context, so its attachment shouldn't be re-sent).
    const compaction = this.selectCompactionForContext([...path].reverse());
    const coveredMessageIds = compaction
      ? new Set(compaction.payload.covered_message_ids)
      : new Set<string>();
    const refs = collectPathAttachmentRefs(
      path,
      new Set(currentSelectionIds),
      coveredMessageIds,
    );
    if (refs.length === 0) {
      return of([]);
    }
    return forkJoin(
      refs.map((ref) =>
        this._attachmentLibrary.materializeById(ref.attachmentId).pipe(
          map((sel): CompleteAttachmentContext | null =>
            sel
              ? {
                  attachmentId: sel.record.id,
                  displayName: sel.fileName,
                  detectedMimeType: sel.mimeType,
                  processorId: sel.processorId ?? 'library',
                  textContext: sel.textContext,
                  contextTruncated: sel.contextTruncated,
                }
              : null,
          ),
        ),
      ),
    ).pipe(
      map((contexts) =>
        contexts.filter(
          (c): c is CompleteAttachmentContext =>
            !!c && (c.textContext ?? '').trim().length > 0,
        ),
      ),
    );
  }

  resolveAttachmentChips(message: Message): Observable<MessageAttachmentChip[]> {
    const uploads = (message.decryptedData.attachments ?? []).filter(
      (a) => a.kind === 'user_upload' && !!a.attachment_id,
    );
    if (uploads.length === 0) {
      return of([]);
    }
    const currentUserId = this._authService.user()?.['id'] as string | undefined;
    const isOwner = !!currentUserId && currentUserId === message.decryptedData.owner_id;

    return forkJoin(
      uploads.map((attachment) => {
        const attachmentId = attachment.attachment_id!;
        // Not the owner (co-participant / public viewer) → private, no fetch.
        if (!isOwner) {
          return of<MessageAttachmentChip>({ attachmentId, state: 'private' });
        }
        return this._uploadService.get(attachmentId).pipe(
          map((record) => this.chipFromRecord(attachmentId, record)),
          // 404 (or any failure) means the file is gone from the library.
          catchError(() =>
            of<MessageAttachmentChip>({ attachmentId, state: 'removed' }),
          ),
        );
      }),
    );
  }

  // chipFromRecord decrypts the owner-sealed manifest to produce a resolved chip
  // (display name + the original artifact's key/file name for download).
  private chipFromRecord(
    attachmentId: string,
    record: { data: string; files: string[] },
  ): MessageAttachmentChip {
    const keyPair = this._vaultService.keyPair();
    if (!keyPair) {
      return { attachmentId, state: 'removed' };
    }
    try {
      const manifestBytes = this._cryptoService.openSealedBox(
        Base64.toUint8Array(record.data),
        keyPair,
      );
      const manifest = JSON.parse(
        new TextDecoder().decode(manifestBytes),
      ) as AttachmentManifestV1;
      const original = manifest.artifacts[0];
      return {
        attachmentId,
        state: 'resolved',
        fileName: manifest.original_name,
        mimeType: manifest.detected_mime_type,
        originalFileName: record.files[0],
        originalKeyB64: original?.key,
      };
    } catch {
      return { attachmentId, state: 'removed' };
    }
  }

  /**
   * Fetch + decrypt a resolved attachment chip's original bytes and trigger a
   * browser download. The per-file key comes from the owner-sealed manifest, so
   * the bytes are decrypted client-side.
   */
  downloadAttachmentChip(chip: MessageAttachmentChip): void {
    if (chip.state !== 'resolved' || !chip.originalFileName || !chip.originalKeyB64) {
      return;
    }
    void this._uploadService
      .downloadArtifact(chip.attachmentId, chip.originalFileName)
      .then((ciphertext) => {
        const plaintext = this._cryptoService.openSecretBox(
          ciphertext,
          Base64.toUint8Array(chip.originalKeyB64!),
        );
        saveBlob(
          plaintext,
          chip.fileName || 'attachment',
          chip.mimeType || 'application/octet-stream',
        );
      })
      .catch(() => {
        /* best-effort download; surface nothing on failure */
      });
  }

  // regenerateResponse asks the model for a fresh reply to an existing message
  // and threads it in as a sibling of the previous response. It reuses the same
  // streaming machinery as sendMessage but never persists a new user turn: the
  // assistant message is parented directly to the message being regenerated.
  private regenerateResponse(message: Message): Observable<Partial<MessageState>> {
    const parentId = message.parentMessageId;
    if (!parentId) {
      return EMPTY;
    }

    const contextPath = regenerateContextPath(this.state.activeBranch().path, parentId);
    if (contextPath.length === 0) {
      return EMPTY;
    }

    const conversation = this._conversationService.conversation();
    const isTemporaryConversation = this._conversationService.isTemporaryConversation();
    if (!conversation && !isTemporaryConversation) {
      return EMPTY;
    }

    if (conversation) {
      this._conversationService.updateConversationUpdatedTimeNow({
        id: conversation.record.id,
      });
    }

    // Regenerating an image message re-runs image generation (the text
    // completion path would drop the image), parented to the same prompt.
    if ((message.decryptedData.attachments?.length ?? 0) > 0) {
      if (!conversation || isTemporaryConversation) {
        return EMPTY;
      }
      return this.regenerateImage(message, parentId, conversation);
    }

    const originConversationId = conversation?.record.id ?? null;

    this.abortActiveCompletion();
    const abortController = new AbortController();
    this._activeCompletionAbort = abortController;
    this.state.setStatus(MessageStatus.Sending);

    const requestId = self.crypto.randomUUID();
    this._activeCompletionRequestId = requestId;
    const selectedPersona = this._personaService.selectedPersona();
    const { messages: regenerationMessages, contextSummary } = this.buildRequestContext(
      [...contextPath].reverse(),
    );
    const request = {
      messages: regenerationMessages,
      modelId: this._modelService.selectedModel().id,
      personaId: selectedPersona.id,
      systemPrompt: this.composeSystemPrompt(
        selectedPersona.systemPrompt,
        conversation,
        regenerationMessages,
        contextSummary,
      ),
      parentMessageId: parentId,
      requestId,
      reasoningEffort: this._modelService.selectedReasoningEffort() || undefined,
      contextSummary,
      webSearch: this.webSearchRequestFlag(),
    };

    // Only requestId + parentMessageId are read by the streaming helpers.
    const streamingRequest: MessageRequest = {
      requestId,
      content: '',
      parentMessageId: parentId,
    };

    let completed = false;

    const response$ = isTemporaryConversation
      ? this._api.completeStream(request, abortController.signal)
      : this._api.regenerateConversationStream(
          originConversationId!,
          request,
          abortController.signal,
        );

    const shouldApplyCompletionUpdate = (): boolean => {
      if (isTemporaryConversation) {
        return this._conversationService.isTemporaryConversation();
      }
      return (
        this._conversationService.conversation()?.record.id === originConversationId
      );
    };

    return response$.pipe(
      concatMap((event) => this.expandStreamEventForDisplay(event)),
      map((event: CompleteStreamEvent) => {
        if (!shouldApplyCompletionUpdate()) {
          return {};
        }

        switch (event.type) {
          case 'delta':
            return {
              messages: applyCompletionStreamDelta(
                this.state().messages,
                streamingRequest,
                event.delta,
                request.personaId,
                request.modelId,
              ),
              // Surface the in-progress response as the active branch.
              branchSelections: {
                ...this.state().branchSelections,
                [parentId]: streamingAssistantMessageId(requestId),
              },
            };
          case 'reasoning_delta':
            return {
              messages: applyCompletionReasoningStreamDelta(
                this.state().messages,
                streamingRequest,
                event.delta,
                request.personaId,
                request.modelId,
              ),
              branchSelections: {
                ...this.state().branchSelections,
                [parentId]: streamingAssistantMessageId(requestId),
              },
            };
          case 'web_search':
            return {
              messages: applyCompletionWebSearchStreamDelta(
                this.state().messages,
                streamingRequest,
                event,
                request.personaId,
                request.modelId,
              ),
              branchSelections: {
                ...this.state().branchSelections,
                [parentId]: streamingAssistantMessageId(requestId),
              },
            };
          case 'complete': {
            completed = true;
            const newAssistantId =
              event.response.assistantMessage.id ??
              streamingAssistantMessageId(requestId);
            return {
              status: MessageStatus.Success,
              messages: applyCompletionStreamResponse(
                this.state().messages,
                requestId,
                event.response,
              ),
              // Keep the freshly generated branch selected.
              branchSelections: {
                ...this.state().branchSelections,
                [parentId]: newAssistantId,
              },
            };
          }
          case 'error':
            throw new Error(event.message);
        }
      }),
      catchError((err: unknown) => {
        if (this.consumeIntentionalCompletionAbort() || isCompletionAbortError(err)) {
          return EMPTY;
        }

        console.error('Error regenerating message');
        this.reportCompletionError(err);

        if (!shouldApplyCompletionUpdate()) {
          return EMPTY;
        }

        return of({
          status: MessageStatus.ErrorSending,
          messages: removeStreamingCompletionMessages(this.state().messages, requestId),
        });
      }),
      finalize(() => {
        if (this._activeCompletionAbort === abortController) {
          this._activeCompletionAbort = null;
          this._activeCompletionRequestId = '';
        }
        if (
          !completed &&
          !this._intentionalCompletionAbort &&
          shouldApplyCompletionUpdate() &&
          this.state.status() === MessageStatus.Sending
        ) {
          this.state.setStatus(MessageStatus.ErrorSending);
        }
        this.consumeIntentionalCompletionAbort();
      }),
    );
  }

  // editAndForkMessage forks the conversation at a user message. Unlike
  // regenerate (which reuses an existing user turn and only adds a new
  // assistant reply), editing creates a NEW user turn as a sibling of the
  // original — same parent — then streams a fresh reply threaded under it. The
  // edited turn is added as the newest sibling and explicitly selected so the
  // active path — and therefore the completion context sendMessage builds — is
  // the edited branch rather than the original. The original turn and its
  // replies stay reachable through the branch switcher.
  private editAndForkMessage(
    original: Message,
    rawContent: string,
  ): Observable<Partial<MessageState>> {
    const content = rawContent.trim();
    if (
      !content ||
      original.decryptedData.deleted ||
      !isMessageFromUser(original.decryptedData)
    ) {
      return EMPTY;
    }

    const conversation = this._conversationService.conversation();
    const isTemporaryConversation = this._conversationService.isTemporaryConversation();
    if (!conversation && !isTemporaryConversation) {
      return EMPTY;
    }

    if (conversation) {
      this._conversationService.updateConversationUpdatedTimeNow({
        id: conversation.record.id,
      });
    }

    // A root user message has no parent; its siblings live under the root key.
    const parentMessageId = original.parentMessageId;
    const forkKey = parentMessageId ?? ROOT_PARENT_KEY;
    const requestId = self.crypto.randomUUID();

    // Edit-fork bypasses _cleanedMessage$, so redact here too: the edited turn
    // must be stored and sent redacted just like a normal send.
    const { redactedText, newEntries } = this._redactionService.prepareRedaction(
      conversation?.record.id ?? null,
      content,
      undefined,
      { kind: 'message', id: requestId },
    );

    const editedMessage: Message = {
      record_id: requestId,
      parentMessageId,
      createdAt: new Date(),
      decryptedData: {
        content: redactedText,
        owner_id: this._authService.user()?.['id'],
      },
    };

    this.state.addMessage(editedMessage);
    this.state.selectBranch({ parentKey: forkKey, childId: requestId });

    return this.sendMessage({
      requestId,
      content: redactedText,
      parentMessageId,
      redactionEntries: newEntries,
    });
  }

  // reportCompletionError routes a failed completion to the right surface and
  // reports whether it "handled" the error with a locked-composer state.
  // Returns true for a billing 402 (opens the plan gate + syncs plan state) or
  // an EMAIL_NOT_VERIFIED 403 (the verify-email composer state carries the
  // recovery path) — both suppress the toast. Returns false for a retryable
  // failure so the caller keeps the user's message and shows an inline retry.
  private reportCompletionError(err: unknown): boolean {
    const restriction = parseCompletionBillingRestriction(err);
    if (restriction) {
      // Lock the composer + surface the in-chat billing banners. No toast — the
      // locked-chat UI and the pricing page carry the recovery path.
      this._billingService.markSendingBlocked(restriction);
      return true;
    }
    if (isEmailNotVerifiedError(err)) {
      // The verify-email composer state (driven by the user's verified flag)
      // already tells the user what to do — no toast, and no retry affordance.
      return true;
    }
    return false;
  }

  // translateCompletionError resolves a CompletionErrorCopy into a display
  // string (translating a key, or passing a backend-authored literal through).
  private translateCompletionError(err: unknown): string {
    const copy = resolveCompletionFailureMessage(err);
    return copy.kind === 'literal' ? copy.value : this._transloco.translate(copy.key);
  }

  // retryFailedSend re-sends the last failed message. The user's message is
  // still in the thread (kept on failure); we remove that optimistic turn and
  // re-inject the original already-redacted request so the send path re-adds it
  // and streams a fresh reply — no re-typing, no double redaction.
  retryFailedSend(): void {
    const request = this._failedRequest;
    if (!request) {
      return;
    }
    this._failedRequest = null;
    this._sendFailed.set(false);
    // Drop the kept optimistic user turn; the resend re-adds it with the same id.
    this.state.deleteMessage({
      messageId: request.requestId,
      deleteChildren: false,
      deleteSiblings: false,
    });
    this._resend$.next(request);
  }

  stopActiveCompletion(): void {
    const requestId = this._activeCompletionRequestId;
    if (!requestId || this.status() !== MessageStatus.Sending) {
      return;
    }

    this._api
      .stopCompletion(requestId)
      .pipe(catchError(() => EMPTY))
      .subscribe();
  }

  private abortActiveCompletion(): void {
    if (!this._activeCompletionAbort) {
      return;
    }

    this._intentionalCompletionAbort = true;
    this._activeCompletionAbort.abort();
    this._activeCompletionAbort = null;
    this._activeCompletionRequestId = '';
  }

  private consumeIntentionalCompletionAbort(): boolean {
    if (!this._intentionalCompletionAbort) {
      return false;
    }

    this._intentionalCompletionAbort = false;
    return true;
  }

  private expandStreamEventForDisplay(
    event: CompleteStreamEvent,
  ): Observable<CompleteStreamEvent> {
    // Reasoning is surfaced live in the disclosure while it streams, so it gets
    // the same smooth, word-by-word typing as the answer.
    if (event.type !== 'delta' && event.type !== 'reasoning_delta') {
      return of(event);
    }

    const type = event.type;
    const chunks = splitStreamDeltaForDisplay(event.delta);
    if (chunks.length <= 1) {
      return of(event);
    }

    return from(chunks).pipe(
      concatMap((chunk, index) => {
        const chunkEvent = { type, delta: chunk } as CompleteStreamEvent;
        return index === 0 ? of(chunkEvent) : of(chunkEvent).pipe(delay(0));
      }),
    );
  }

  // webSearchRequestFlag maps the composer's web-search state onto the request
  // field (spec §4.2): `false` when search is off (opted out, or the model can't
  // search), otherwise `undefined` so the field is omitted and the backend
  // applies its auto-on default for capable models.
  private webSearchRequestFlag(): boolean | undefined {
    return this._composerTools.webSearchEnabled() ? undefined : false;
  }

  private createMessageContext(): {
    messages: Array<CompletionMessageRequest>;
    contextSummary?: string;
  } {
    // Context follows the active branch (newest-first), so the model only sees
    // the conversation the user is actually viewing.
    return this.buildRequestContext([...this.state.activeBranch().path].reverse());
  }

  // Builds the system prompt sent with a completion. When the conversation
  // belongs to a project, the project's instructions are prepended to the
  // persona prompt so every chat in the project inherits that guidance — with
  // any PII in them redacted (see redactProjectInstructions). The documents
  // contract is appended when the "Create documents" tool is enabled (absent
  // entirely when the user opted out, so the payload is unchanged from today).
  // The redaction instruction is appended whenever the prompt or context
  // carries placeholders, so the model preserves them across the round-trip.
  private composeSystemPrompt(
    personaPrompt: string,
    conversation: Conversation | null | undefined,
    messages: ReadonlyArray<CompletionMessageRequest>,
    contextSummary?: string,
    attachmentContexts?: ReadonlyArray<CompleteAttachmentContext>,
  ): string {
    const instructions = this.redactProjectInstructions(conversation);
    // The injected memory (contextSummary) can carry redaction placeholders even
    // when no raw message does — so the model still needs the preserve-tokens
    // instruction in that case. Attachment text is redacted client-side too and
    // is appended to the prompt server-side, so its tokens only live in the
    // attachment contexts at this point — check them as well.
    const hasRedactions =
      containsRedactionToken(instructions) ||
      (!!contextSummary && containsRedactionToken(contextSummary)) ||
      messages.some((message) => containsRedactionToken(message.content)) ||
      (attachmentContexts?.some((context) =>
        containsRedactionToken(context.textContext ?? ''),
      ) ??
        false);
    return composeSystemPromptSections(
      instructions,
      personaPrompt,
      this._composerTools.documentsEnabled(),
      hasRedactions,
    );
  }

  // Returns a project's instructions with PII replaced by placeholder tokens,
  // mirroring message redaction: detection runs client-side, the raw values are
  // swapped for stable tokens before the prompt is sent, and the new mappings
  // are persisted to THIS conversation (best-effort) so a token the model echoes
  // hydrates back to the original on display. Tokens are reused across messages
  // and instructions within a conversation. Returns the raw instructions (or '')
  // when there is no project, no instructions, redaction is off, or the
  // conversation is temporary (no row to attach mappings to).
  private redactProjectInstructions(
    conversation: Conversation | null | undefined,
  ): string {
    const projectId = conversation?.record.project;
    const project = projectId
      ? this._projectService.projects().find((p) => p.record.id === projectId)
      : undefined;
    const instructions = project?.decryptedData.instructions?.trim() ?? '';

    if (
      !instructions ||
      !projectId ||
      !conversation ||
      !this._redactionService.enabled() ||
      this._conversationService.isTemporaryConversation()
    ) {
      return instructions;
    }

    const candidates = this._redactionService.detect(instructions);
    if (candidates.length === 0) {
      return instructions;
    }

    const source = { kind: 'document' as const, id: projectId };
    const { redactedText, newEntries } = this._redactionService.prepareRedaction(
      conversation.record.id,
      instructions,
      candidates,
      source,
    );
    if (newEntries.length > 0) {
      this._redactionService.persist(conversation, newEntries, source).subscribe({
        error: () => {
          // Best-effort: the instructions were already redacted before sending,
          // so a persistence failure costs the owner hydration, not a leak.
        },
      });
    }
    return redactedText;
  }

  // buildRequestContext turns the active-branch path (newest-first) into the
  // outgoing completion context. When a valid compaction covers an older prefix
  // of the branch, those messages are dropped from the raw context and the
  // summary is returned as contextSummary for the backend to fold into the
  // system prompt (spec §9).
  private buildRequestContext(messagesNewestFirst: ReadonlyArray<Message>): {
    messages: Array<CompletionMessageRequest>;
    contextSummary?: string;
  } {
    const model = this._modelService.selectedModel();
    const conversation = this._conversationService.conversation();
    const conversationId = conversation?.record.id ?? null;
    const projectId = conversation?.record.project ?? null;
    const compaction = this.selectCompactionForContext(messagesNewestFirst);
    // Memory from every scope is combined into the injected context: the
    // user-curated conversation memory, the active-branch auto-compaction, and
    // the branch-independent project + user memory (spec §16).
    const manual = conversationId
      ? this._compactionService.manualMemoryFor(conversationId)
      : null;
    const projectMemory = projectId
      ? this._scopedMemory.projectMemoryFor(projectId)
      : null;
    const userMemory = this._scopedMemory.userMemory();
    const excludeMessageIds = compaction
      ? new Set(compaction.payload.covered_message_ids)
      : undefined;
    const messages = buildCompletionMessageContext(
      messagesNewestFirst,
      model.inputContextLength,
      (id) => this._personaService.getPersona(id)()?.name,
      (id) => this._modelService.getModel(id)?.name,
      { charsPerToken: model.approxCharsPerToken, excludeMessageIds },
    );
    return {
      messages,
      contextSummary: renderCombinedMemory({
        conversationManual: manual,
        conversationAuto: compaction,
        projectMemory,
        userMemory,
      }),
    };
  }

  // selectCompactionForContext returns the newest compaction valid for the
  // active branch, or null when there is no persisted conversation or no valid
  // compaction.
  private selectCompactionForContext(
    messagesNewestFirst: ReadonlyArray<Message>,
  ): ReturnType<CompactionService['newestValidForBranch']> {
    const conversation = this._conversationService.conversation();
    if (!conversation) {
      return null;
    }
    const branchMessageIds = [...messagesNewestFirst]
      .reverse()
      .map((message) => message.record_id)
      .filter((id): id is string => !!id);
    return this._compactionService.newestValidForBranch(
      conversation.record.id,
      branchMessageIds,
    );
  }

  // newestRecordedContextTokens returns the real prompt-token count from the most
  // recent assistant turn that recorded one. That input_tokens value is the
  // provider's exact measurement of everything we last sent (system + context +
  // user), so it is the most accurate available estimate of current context size
  // — already accounting for any compaction summary that was in play (spec §10.1).
  private newestRecordedContextTokens(path: ReadonlyArray<Message>): number | null {
    for (let i = path.length - 1; i >= 0; i--) {
      const tokens = path[i].decryptedData.input_tokens;
      if (tokens && tokens > 0) {
        return tokens;
      }
    }
    return null;
  }

  // maybeTriggerCompaction opportunistically compacts the older prefix of the
  // active branch in the background once raw context passes the trigger
  // threshold. Non-blocking, at most one in flight per conversation, and never
  // for temporary, disappearing-message or project conversations (spec §10, §12).
  private maybeTriggerCompaction(conversationId: string): void {
    const conversation = this._conversationService.conversation();
    if (!conversation || conversation.record.id !== conversationId) {
      return;
    }
    if (this._conversationService.isTemporaryConversation()) {
      return;
    }
    // Disappearing-message and project conversations are out of scope for V1.
    if (conversation.record.expiry_duration || conversation.record.project) {
      return;
    }
    if (this._compactionInFlight.has(conversationId)) {
      return;
    }

    const model = this._modelService.selectedModel();
    if (!model.eligibleForCompaction) {
      return;
    }

    const branch: CompactionPlanMessage[] = this.state
      .activeBranch()
      .path.filter(
        (message): message is Message & { record_id: string } =>
          !!message.record_id &&
          !message.decryptedData.deleted &&
          !!message.decryptedData.content,
      )
      .map((message) => ({
        recordId: message.record_id,
        role: message.decryptedData.owner_id ? 'user' : 'assistant',
        content: message.decryptedData.content ?? '',
      }));

    const branchIds = branch.map((message) => message.recordId);
    const existingValid = this._compactionService.newestValidForBranch(
      conversationId,
      branchIds,
    );

    const charsPerToken = model.approxCharsPerToken > 0 ? model.approxCharsPerToken : 2;
    const usableContextChars = model.inputContextLength * charsPerToken;

    // Prefer the provider's real prompt-token count from the latest turn; fall
    // back to the character heuristic only when no turn has recorded one yet.
    const realContextTokens = this.newestRecordedContextTokens(
      this.state.activeBranch().path,
    );
    const triggered =
      realContextTokens !== null
        ? shouldTriggerCompaction(realContextTokens, model.inputContextLength)
        : shouldTriggerCompaction(
            estimateRawContextChars(branch, existingValid),
            usableContextChars,
          );
    if (!triggered) {
      return;
    }

    const plan = planCompaction(branch, { usableContextChars, existingValid });
    if (!plan) {
      return;
    }

    const request: ApiCreateCompactionRequest = {
      request_id: self.crypto.randomUUID(),
      model_id: model.id,
      anchor_message_id: plan.anchorMessageId,
      source_token_estimate: Math.ceil(
        plan.messages.reduce((sum, message) => sum + message.content.length, 0) /
          charsPerToken,
      ),
      messages: plan.messages.map((message) => ({
        alias: message.alias,
        message_id: message.messageId,
        role: message.role,
        content: message.content,
      })),
    };
    if (plan.parent) {
      request.parent_compaction_id = plan.parent.recordId;
      request.parent_compaction_level = plan.parent.payload.compaction_level;
      request.prior_summary = {
        durable_memory: plan.parent.payload.durable_memory,
        rolling_narrative: plan.parent.payload.rolling_narrative,
        covered_message_ids: plan.parent.payload.covered_message_ids,
      };
    }

    this._compactionInFlight.add(conversationId);
    this._compactionService
      .create(conversationId, request)
      .pipe(finalize(() => this._compactionInFlight.delete(conversationId)))
      .subscribe({
        error: () => {
          // Best-effort background work; a later response retries.
        },
      });
  }

  private generateConversationTitle(
    startingMessage: string,
  ): Observable<string | null> {
    const model = this._modelService.selectedModel();
    return this._api
      .complete({
        maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
        persist: false,
        messages: [
          {
            role: 'user',
            content: buildTitleGenerationUserMessage(startingMessage),
          },
        ],
        modelId: model.id,
        personaId: generateConversationPersonaId,
        systemPrompt: generateConversationSystemPrompt,
        // Disable reasoning when the model supports it — otherwise a reasoning
        // model burns the small output budget on hidden reasoning and returns
        // no title text. When it can't be disabled, send the lowest tier so the
        // backend sizes an explicit thinking budget and raises max_tokens above
        // it (see the reasoning-output-budget business process).
        reasoningEffort: titleReasoningEffort(model.reasoningEfforts),
      })
      .pipe(
        catchError((err) => {
          console.error('Error generating conversation title', err);
          return EMPTY;
        }),
        map((resp) => resp.assistantMessage.content || null),
      );
  }

  private generateAndSetConversationTitle(
    conversation: { id: string; expiry_duration?: string },
    startingMessage: string,
  ): Observable<{ id: string; expiry_duration?: string }> {
    return this.generateConversationTitle(startingMessage).pipe(
      filterNil(),
      switchMap((title) => {
        // Use max the first 10 words
        title = title.split(' ').slice(0, 10).join(' ');
        return this._conversationService.editConversation(
          conversation.id,
          conversation.expiry_duration ?? '',
          { title },
        );
      }),
    );
  }

  // softDeleteMessage replaces a message's content with a re-encrypted
  // tombstone, keeping the node (and its role/parent/timestamp) so the thread
  // stays intact. The original ciphertext is overwritten server-side, so the
  // real content is removed rather than merely hidden.
  private softDeleteMessage(message: Message): Observable<Partial<MessageState>> {
    const recordId = message.record_id;
    if (!recordId) {
      return EMPTY;
    }

    const tombstone = buildDeletedMessageData(message.decryptedData);

    const applyLocal = (): Partial<MessageState> => ({
      messages: this.state().messages.map((msg) =>
        msg.record_id === recordId
          ? { ...msg, decryptedData: tombstone, expires: undefined }
          : msg,
      ),
    });

    const conversation = this._conversationService.conversation();
    if (!conversation) {
      // Temporary (non-persisted) conversation: tombstone in memory only.
      return of(applyLocal());
    }

    const sealed = this._cryptoService.createSealedBox(
      new TextEncoder().encode(JSON.stringify(tombstone)),
      conversation.keyPair.publicKey,
    );

    return this._api.softDeleteMessage(recordId, Base64.fromUint8Array(sealed)).pipe(
      map(() => {
        this._conversationService.updateConversationUpdatedTimeNow({
          id: conversation.record.id,
        });
        // Remove any compaction (and fold-chain descendants) representing the
        // deleted message so its content cannot survive in a summary (spec §12).
        this._compactionService
          .invalidateForDeletedMessage(conversation.record.id, recordId)
          .subscribe({
            error: () => {
              // Best-effort: a failure is retried on the next deletion/reload.
            },
          });
        return applyLocal();
      }),
      catchError((err) => {
        console.error('Error deleting message');
        this._errorService.alert(this.translateCompletionError(err));
        return EMPTY;
      }),
    );
  }

  private persistKeptExpiringMessage(
    message: Message,
  ): Observable<Partial<MessageState>> {
    // Updates a message in the backend to remove the expiry time
    if (!message.record_id) {
      return EMPTY;
    }

    return this._api.updateMessage(message.record_id, true).pipe(
      map(() => {
        return {
          messages: this.state().messages.map((msg) => {
            if (msg.record_id === message.record_id) {
              return {
                ...msg,
                expires: undefined,
              };
            }
            return msg;
          }),
        };
      }),
    );
  }
}
