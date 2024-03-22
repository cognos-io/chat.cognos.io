import { inject } from '@angular/core';

import PocketBase from 'pocketbase';

import OpenAI from 'openai';
import { Headers } from 'openai/dist/core';

import { TypedPocketBase } from '@app/types/pocketbase-types';

import { environment } from '@environments/environment';

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
  });
};

export const provideOpenAi = () => {
  return {
    provide: OpenAI,
    useFactory: openAiFactory,
  };
};
