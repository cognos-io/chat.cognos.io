import { describe, expect, it } from 'vitest';

import {
  mapCompleteRequest,
  mapCompleteResponse,
  parseCompleteStreamData,
} from './cognos-api.service';

describe('mapCompleteRequest', () => {
  it('maps camelCase request fields onto the wire snake_case shape', () => {
    const wire = mapCompleteRequest({
      messages: [{ role: 'user', content: 'hi' }],
      modelId: 'infomaniak:llama-3',
      personaId: 'cognos:simple-assistant',
      systemPrompt: 'Be helpful.',
      parentMessageId: 'msg-1',
      requestId: 'req-1',
      maxOutputTokens: 256,
      persist: true,
    });

    expect(wire).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      model_id: 'infomaniak:llama-3',
      persona_id: 'cognos:simple-assistant',
      system_prompt: 'Be helpful.',
      parent_message_id: 'msg-1',
      request_id: 'req-1',
      max_output_tokens: 256,
      persist: true,
    });
  });

  it('passes optional fields through as undefined when absent', () => {
    const wire = mapCompleteRequest({
      messages: [],
      modelId: 'm',
      personaId: 'a',
      systemPrompt: 'prompt',
    });

    // We deliberately do NOT default these to null or omit them — sending
    // explicit undefined keeps the JSON encoder responsible for elision and
    // mirrors how the backend's omitempty contract reads the payload.
    expect(wire.parent_message_id).toBeUndefined();
    expect(wire.request_id).toBeUndefined();
    expect(wire.max_output_tokens).toBeUndefined();
    expect(wire.persist).toBeUndefined();
  });
});

describe('parseCompleteStreamData', () => {
  it('maps delta events without touching the payload', () => {
    expect(parseCompleteStreamData('{"type":"delta","delta":"hello"}')).toEqual({
      type: 'delta',
      delta: 'hello',
    });
  });

  it('maps complete events through the standard response mapper', () => {
    const response = {
      request_id: 'req-1',
      user_message_id: 'user-1',
      expires_at: '2026-01-03T00:00:00.000Z',
      assistant_message: {
        id: 'asst-1',
        parent_message_id: 'user-1',
        content: 'hello back',
        persona_id: 'cognos:simple-assistant',
        model_id: 'infomaniak:llama-3',
        created_at: '2026-01-02T03:04:05.000Z',
      },
      usage: {
        input_tokens: 12,
        output_tokens: 34,
        total_tokens: 46,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 7,
        cost_usd: 0.0001,
        cost_chf: 0.00009,
        cost_rappen: 1,
        used_provider_cost: true,
      },
    };

    expect(
      parseCompleteStreamData(JSON.stringify({ type: 'complete', response })),
    ).toEqual({
      type: 'complete',
      response: mapCompleteResponse(response),
    });
  });

  it('passes stream error events through verbatim', () => {
    expect(
      parseCompleteStreamData(
        '{"type":"error","message":"Failed to process completion"}',
      ),
    ).toEqual({
      type: 'error',
      message: 'Failed to process completion',
    });
  });
});

describe('mapCompleteResponse', () => {
  // A backend rename of any usage/* field would otherwise silently surface
  // as `undefined` on the frontend's CompleteResponse — costRappen would
  // disappear from billing UI without a test failure to catch it. This
  // exhaustively pins the wire ↔ camelCase mapping.
  const wireResponse = () => ({
    request_id: 'req-1',
    user_message_id: 'user-1',
    expires_at: '2026-01-03T00:00:00.000Z',
    assistant_message: {
      id: 'asst-1',
      parent_message_id: 'user-1',
      content: 'hello back',
      persona_id: 'cognos:simple-assistant',
      model_id: 'infomaniak:llama-3',
      created_at: '2026-01-02T03:04:05.000Z',
    },
    usage: {
      input_tokens: 12,
      output_tokens: 34,
      total_tokens: 46,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 7,
      cost_usd: 0.0001,
      cost_chf: 0.00009,
      cost_rappen: 1,
      used_provider_cost: true,
    },
  });

  it('maps every documented field onto the camelCase shape', () => {
    expect(mapCompleteResponse(wireResponse())).toEqual({
      requestId: 'req-1',
      userMessageId: 'user-1',
      expiresAt: '2026-01-03T00:00:00.000Z',
      assistantMessage: {
        id: 'asst-1',
        parentMessageId: 'user-1',
        content: 'hello back',
        personaId: 'cognos:simple-assistant',
        modelId: 'infomaniak:llama-3',
        createdAt: '2026-01-02T03:04:05.000Z',
      },
      usage: {
        inputTokens: 12,
        outputTokens: 34,
        totalTokens: 46,
        cacheCreationInputTokens: 5,
        cacheReadInputTokens: 7,
        costUSD: 0.0001,
        costCHF: 0.00009,
        costRappen: 1,
        usedProviderCost: true,
      },
    });
  });

  it('propagates usedProviderCost=false (the provider-cost-absent path)', () => {
    // The fallback pricing path sets used_provider_cost=false; the frontend
    // surfaces this so dashboards can distinguish provider-reported vs
    // catalogue-derived cost. A boolean miscast (e.g. truthy on undefined)
    // would corrupt the audit trail.
    const response = wireResponse();
    response.usage.used_provider_cost = false;

    expect(mapCompleteResponse(response).usage.usedProviderCost).toBe(false);
  });

  it('preserves expires_at as a string for the caller to parse', () => {
    // Date construction happens downstream in buildCompletionMessages so
    // mapCompleteResponse stays pure and timezone-safe. Pin the
    // pass-through instead of asserting on Date.
    const r = wireResponse();
    expect(mapCompleteResponse(r).expiresAt).toBe('2026-01-03T00:00:00.000Z');
  });

  it('leaves optional top-level identifiers undefined when omitted by the wire', () => {
    const r = wireResponse();
    delete (r as Partial<ReturnType<typeof wireResponse>>).request_id;
    delete (r as Partial<ReturnType<typeof wireResponse>>).user_message_id;
    delete (r as Partial<ReturnType<typeof wireResponse>>).expires_at;

    const result = mapCompleteResponse(r);
    expect(result.requestId).toBeUndefined();
    expect(result.userMessageId).toBeUndefined();
    expect(result.expiresAt).toBeUndefined();
  });
});
