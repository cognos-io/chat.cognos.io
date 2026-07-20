import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import PocketBase from 'pocketbase';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CognosApiService,
  CompleteStreamEvent,
  mapCompleteRequest,
  mapCompleteResponse,
  mapGenerateImageRequest,
  mapOrganisationRecord,
  parseCompleteStreamData,
} from './cognos-api.service';

describe('CognosApiService', () => {
  it('posts explicit completion stops with auth', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        CognosApiService,
        {
          provide: PocketBase,
          useValue: {
            authStore: {
              token: 'test-token',
            },
          },
        },
      ],
    });

    const service = TestBed.inject(CognosApiService);
    const httpController = TestBed.inject(HttpTestingController);

    service.stopCompletion('req/with spaces').subscribe();

    const request = httpController.expectOne(
      'http://localhost:8090/api/v1/completions/req%2Fwith%20spaces/stop',
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    expect(request.request.headers.get('Authorization')).toBe('Bearer test-token');
    request.flush(null);
    httpController.verify();
    TestBed.resetTestingModule();
  });

  describe('completeStream frame resilience (spec §10)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      TestBed.resetTestingModule();
    });

    const frame = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;

    const completeResponse = {
      request_id: 'req-1',
      assistant_message: {
        id: 'asst-1',
        content: 'Hello',
        persona_id: 'p',
        model_id: 'm',
        created_at: '2026-01-02T03:04:05.000Z',
      },
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        reasoning_tokens: 0,
        cost_usd: 0,
        cost_chf: 0,
        cost_rappen: 0,
        used_provider_cost: false,
      },
    };

    it('skips malformed and unknown frames yet still applies deltas and completes', async () => {
      // A malformed frame (truncated JSON) and an unknown event type sit between
      // valid deltas; the stream must deliver every good event and complete
      // normally rather than aborting on the bad frames.
      const body =
        frame({ type: 'delta', delta: 'Hel' }) +
        'data: {"type":"web_search"\n\n' + // malformed JSON → skipped (warns)
        frame({ type: 'mystery', surprise: 1 }) + // unknown type → skipped (silent)
        frame({ type: 'delta', delta: 'lo' }) +
        frame({ type: 'complete', response: completeResponse });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
          },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          CognosApiService,
          {
            provide: PocketBase,
            useValue: { authStore: { token: 'test-token' } },
          },
        ],
      });
      const service = TestBed.inject(CognosApiService);

      const events: CompleteStreamEvent[] = [];
      await new Promise<void>((resolve, reject) => {
        service
          .completeStream({
            messages: [],
            modelId: 'm',
            personaId: 'p',
            systemPrompt: '',
          })
          .subscribe({
            next: (event) => events.push(event),
            error: reject,
            complete: resolve,
          });
      });

      // Both valid deltas survived, in order; the complete event closed it out.
      expect(events.map((e) => e.type)).toEqual(['delta', 'delta', 'complete']);
      expect(events.filter((e) => e.type === 'delta').map((e) => e.delta)).toEqual([
        'Hel',
        'lo',
      ]);

      // The malformed frame warned once with a static, payload-free message; the
      // unknown-type frame was skipped silently (no extra warning).
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipping malformed completion stream frame',
      );
    });
  });
});

// Pin (issue B1): the backend sends the caller's org role as `caller_role`
// (backend/internal/handler/organisations.go, pinned by
// e2e/tests/organisations-api.spec.ts) while the app-side OrganisationRecord
// reads `role`. Without this mapping every consumer saw role === undefined —
// Owners degraded to the member view and admin surfaces vanished.
describe('organisation caller_role wire mapping (issue B1)', () => {
  const wireOrg = (overrides: Record<string, unknown> = {}) => ({
    id: 'org_1',
    name: 'Acme',
    owner: 'user_owner',
    caller_role: 'owner',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-02T00:00:00Z',
    policy_privacy_tier: '',
    policy_retention_days: 0,
    policy_mfa_required: false,
    ...overrides,
  });

  function setup(): { service: CognosApiService; http: HttpTestingController } {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        CognosApiService,
        {
          provide: PocketBase,
          useValue: { authStore: { token: 'test-token' } },
        },
      ],
    });
    return {
      service: TestBed.inject(CognosApiService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('maps caller_role onto role for every GET /orgs list item', () => {
    const { service, http } = setup();

    let result: { role: string }[] = [];
    service.listOrgs().subscribe((orgs) => (result = orgs));

    http
      .expectOne('http://localhost:8090/api/v1/orgs')
      .flush([
        wireOrg({ id: 'org_1', caller_role: 'owner' }),
        wireOrg({ id: 'org_2', caller_role: 'member' }),
      ]);

    expect(result.map((org) => org.role)).toEqual(['owner', 'member']);
    // The wire field never leaks into the app shape.
    expect('caller_role' in result[0]).toBe(false);
  });

  it('maps caller_role on create, get, rename and policies responses', () => {
    const { service, http } = setup();
    const calls: {
      run: () => void;
      url: string;
      flush: Record<string, unknown>;
      expected: string;
    }[] = [
      {
        // A freshly created Organisation always answers with the creator as
        // owner (the backend hardcodes RoleOwner on POST /orgs).
        run: () => service.createOrg({ name: 'Acme' }).subscribe(seen),
        url: 'http://localhost:8090/api/v1/orgs',
        flush: wireOrg({ caller_role: 'owner' }),
        expected: 'owner',
      },
      {
        run: () => service.getOrg('org_1').subscribe(seen),
        url: 'http://localhost:8090/api/v1/orgs/org_1',
        flush: wireOrg({ caller_role: 'member' }),
        expected: 'member',
      },
      {
        run: () => service.updateOrg('org_1', { name: 'Acme 2' }).subscribe(seen),
        url: 'http://localhost:8090/api/v1/orgs/org_1',
        flush: wireOrg({ caller_role: 'admin' }),
        expected: 'admin',
      },
      {
        run: () =>
          service
            .updateOrgPolicies('org_1', { policy_mfa_required: true })
            .subscribe(seen),
        url: 'http://localhost:8090/api/v1/orgs/org_1/policies',
        flush: wireOrg({ caller_role: 'admin' }),
        expected: 'admin',
      },
    ];

    let role: string | undefined;
    function seen(org: { role: string }): void {
      role = org.role;
    }

    for (const call of calls) {
      role = undefined;
      call.run();
      http.expectOne(call.url).flush(call.flush);
      expect(role).toBe(call.expected);
    }
  });

  it('dissolves an Organisation only with explicit Project deletion', () => {
    const { service, http } = setup();

    service.dissolveOrg('org_1').subscribe();

    const request = http.expectOne('http://localhost:8090/api/v1/orgs/org_1');
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toEqual({ delete_projects: true });
    expect(request.request.headers.get('Authorization')).toBe('Bearer test-token');
    request.flush(null);
  });

  it('lists paginated content-free organisation audit metadata', () => {
    const { service, http } = setup();
    const response = {
      page: 2,
      perPage: 25,
      totalItems: 26,
      totalPages: 2,
      items: [
        {
          id: 'event_1',
          action: 'org.policies.updated',
          actor: 'user_1',
          created: '2026-07-18T12:00:00Z',
        },
      ],
    };
    let result: typeof response | undefined;

    service.listOrgAudit('org_1', 2, 25).subscribe((value) => (result = value));

    const request = http.expectOne(
      'http://localhost:8090/api/v1/orgs/org_1/audit?page=2&page_size=25',
    );
    expect(request.request.headers.get('Authorization')).toBe('Bearer test-token');
    request.flush(response);
    expect(result).toEqual(response);
  });

  it('downloads the complete organisation audit export as a blob', () => {
    const { service, http } = setup();
    const csv = new Blob(['created,action,actor,target'], { type: 'text/csv' });
    let result: Blob | undefined;

    service.exportOrgAudit('org_1').subscribe((value) => (result = value));

    const request = http.expectOne(
      'http://localhost:8090/api/v1/orgs/org_1/audit/export',
    );
    expect(request.request.responseType).toBe('blob');
    expect(request.request.headers.get('Authorization')).toBe('Bearer test-token');
    request.flush(csv);
    expect(result).toBe(csv);
  });
});

describe('mapOrganisationRecord', () => {
  it('maps caller_role onto role and drops the wire field', () => {
    const mapped = mapOrganisationRecord({
      id: 'org_1',
      name: 'Acme',
      caller_role: 'admin',
      created: '2026-01-01T00:00:00Z',
      policy_privacy_tier: 'eu',
      policy_retention_days: 30,
      policy_mfa_required: true,
    });

    expect(mapped).toEqual({
      id: 'org_1',
      name: 'Acme',
      role: 'admin',
      created: '2026-01-01T00:00:00Z',
      policy_privacy_tier: 'eu',
      policy_retention_days: 30,
      policy_mfa_required: true,
    });
  });

  it('defaults a missing caller_role to least-privilege member', () => {
    // caller_role is json omitempty on the wire; a response that ever elides
    // it must fail towards member so no admin surface appears by accident.
    const mapped = mapOrganisationRecord({
      id: 'org_1',
      name: 'Acme',
      created: '2026-01-01T00:00:00Z',
      policy_privacy_tier: '',
      policy_retention_days: 0,
      policy_mfa_required: false,
    });

    expect(mapped.role).toBe('member');
  });
});

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

  it('maps attachment ids and contexts onto snake_case wire fields', () => {
    const wire = mapCompleteRequest({
      messages: [{ role: 'user', content: 'summarise' }],
      modelId: 'm',
      personaId: 'a',
      systemPrompt: 'prompt',
      attachmentIds: ['att-1', 'att-2'],
      attachmentContexts: [
        {
          attachmentId: 'att-1',
          displayName: 'notes.txt',
          detectedMimeType: 'text/plain',
          processorId: 'text',
          textContext: 'body',
          contextTruncated: false,
        },
      ],
    });

    expect(wire.attachment_ids).toEqual(['att-1', 'att-2']);
    expect(wire.attachment_contexts).toEqual([
      {
        attachment_id: 'att-1',
        display_name: 'notes.txt',
        detected_mime_type: 'text/plain',
        processor_id: 'text',
        text_context: 'body',
        context_truncated: false,
      },
    ]);
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
    // web_search is omitted unless the user explicitly opts out.
    expect(wire.web_search).toBeUndefined();
  });

  it('carries an explicit web_search opt-out onto the wire', () => {
    const wire = mapCompleteRequest({
      messages: [],
      modelId: 'm',
      personaId: 'a',
      systemPrompt: 'prompt',
      webSearch: false,
    });

    expect(wire.web_search).toBe(false);
  });
});

describe('mapGenerateImageRequest', () => {
  it('carries the prompt parent separately from regeneration parent', () => {
    const wire = mapGenerateImageRequest({
      prompt: 'go for it',
      modelId: 'gemini-2-5-flash-image',
      messages: [
        { role: 'user', content: 'start a text conversation' },
        { role: 'assistant', content: 'ready' },
        { role: 'user', content: 'go for it' },
      ],
      promptParentMessageId: 'assistant-text-1',
      requestId: 'img-req-1',
    });

    expect(wire).toEqual({
      prompt: 'go for it',
      model_id: 'gemini-2-5-flash-image',
      messages: [
        { role: 'user', content: 'start a text conversation' },
        { role: 'assistant', content: 'ready' },
        { role: 'user', content: 'go for it' },
      ],
      parent_message_id: undefined,
      prompt_parent_message_id: 'assistant-text-1',
      request_id: 'img-req-1',
    });
  });

  it('keeps parent_message_id for regenerating an existing image', () => {
    const wire = mapGenerateImageRequest({
      prompt: 'go for it',
      modelId: 'gemini-2-5-flash-image',
      parentMessageId: 'prompt-1',
    });

    expect(wire.parent_message_id).toBe('prompt-1');
    expect(wire.prompt_parent_message_id).toBeUndefined();
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
        reasoning_tokens: 8,
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

  it('maps reasoning_delta events onto their own event type', () => {
    expect(
      parseCompleteStreamData('{"type":"reasoning_delta","delta":"thinking"}'),
    ).toEqual({
      type: 'reasoning_delta',
      delta: 'thinking',
    });
  });

  it('maps a well-formed web_search frame, camelCasing citation_anchors', () => {
    const frame = JSON.stringify({
      type: 'web_search',
      citations: [{ url: 'https://reuters.com', title: 'reuters.com', snippet: '' }],
      citation_anchors: [{ citation: 0, start: 19, end: 24 }],
      search_activity: 'started',
    });

    expect(parseCompleteStreamData(frame)).toEqual({
      type: 'web_search',
      citations: [{ url: 'https://reuters.com', title: 'reuters.com', snippet: '' }],
      anchors: [{ citation: 0, start: 19, end: 24 }],
      searchActivity: 'started',
    });
  });

  it('maps a pure-activity web_search frame with no citations', () => {
    expect(
      parseCompleteStreamData('{"type":"web_search","search_activity":"completed"}'),
    ).toEqual({
      type: 'web_search',
      searchActivity: 'completed',
    });
  });

  it('ignores malformed citations/anchors/activity in a web_search frame', () => {
    const frame = JSON.stringify({
      type: 'web_search',
      citations: [{ title: 'no url here' }, { url: 'https://ok.com' }],
      citation_anchors: [{ citation: 'bad' }, { citation: 0, start: 1, end: 2 }],
      search_activity: 'nonsense',
    });

    // The url-less citation and the malformed anchor are dropped; the bad
    // activity string is ignored (a benign no-op frame), never throwing.
    expect(parseCompleteStreamData(frame)).toEqual({
      type: 'web_search',
      citations: [{ url: 'https://ok.com' }],
      anchors: [{ citation: 0, start: 1, end: 2 }],
    });
  });

  it('returns an empty web_search event when the payload is entirely malformed', () => {
    expect(parseCompleteStreamData('{"type":"web_search","citations":"oops"}')).toEqual(
      { type: 'web_search' },
    );
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

  it('tolerates unknown extra fields on a web_search frame and its citations', () => {
    // Forward-compat: a provider (or a newer backend) may add fields. Unknown
    // keys at the frame, citation and anchor level are ignored, not fatal.
    const frame = JSON.stringify({
      type: 'web_search',
      provider: 'vertex-gemini', // unknown top-level field
      citations: [{ url: 'https://ok.com', title: 't', favicon: 'x' }],
      citation_anchors: [{ citation: 0, start: 1, end: 2, confidence: 0.9 }],
      search_activity: 'started',
    });

    expect(parseCompleteStreamData(frame)).toEqual({
      type: 'web_search',
      citations: [{ url: 'https://ok.com', title: 't' }],
      anchors: [{ citation: 0, start: 1, end: 2 }],
      searchActivity: 'started',
    });
  });

  it('skips a malformed (non-JSON) frame instead of failing the stream (spec §10)', () => {
    // Spec §10: a corrupt frame is ignored (returns null) so the stream reader
    // continues with the next frame rather than aborting the whole completion.
    expect(parseCompleteStreamData('{"type":"web_search"')).toBeNull();
  });

  it('skips an unknown event type silently (spec §10 forward-compat)', () => {
    // A frame that parses but carries a type this client does not know is
    // skipped, so a newer backend event kind never breaks an older client.
    expect(parseCompleteStreamData('{"type":"mystery"}')).toBeNull();
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
      reasoning: 'because the inputs imply it',
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
      reasoning_tokens: 8,
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
        reasoning: 'because the inputs imply it',
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
        reasoningTokens: 8,
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
