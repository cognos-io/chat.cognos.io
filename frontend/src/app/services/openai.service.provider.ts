import { inject } from '@angular/core';

import PocketBase from 'pocketbase';

import OpenAI from 'openai';
import { Headers } from 'openai/core';

import { TypedPocketBase } from '@app/types/pocketbase-types';

import { environment } from '@environments/environment';

export interface CognosMetadataResponse {
  request_id?: string;
  parent_message_id?: string;
  message_record_id?: string;
  response_record_id?: string;
  expires_at?: string; // When the messages will expire in RFC1123Z format
}

export interface ChatCompletionResponseWithMetadata extends OpenAI.ChatCompletion {
  metadata?: {
    cognos?: CognosMetadataResponse;
  };
}

export class CognosOpenAI extends OpenAI {
  private readonly pb: TypedPocketBase = inject(PocketBase);

  protected override authHeaders(): Headers {
    return {
      Authorization: this.pb.authStore.token,
    };
  }
}

const openAiFactory = () => {
  return new CognosOpenAI({
    baseURL: `${environment.pocketbaseBaseUrl}/v1`,
    apiKey: '',
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
  });
};

export const provideOpenAi = () => {
  return {
    provide: OpenAI,
    useFactory: openAiFactory,
  };
};
