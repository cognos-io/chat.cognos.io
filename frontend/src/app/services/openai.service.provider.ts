import OpenAI from 'openai';

import { environment } from '@environments/environment';

const openAiFactory = () => {
  return new OpenAI({
    baseURL: environment.pocketbaseBaseUrl,
    apiKey: environment.openaiApiKey,
    dangerouslyAllowBrowser: true,
  });
};

export const provideOpenAi = () => {
  return {
    provide: OpenAI,
    useFactory: openAiFactory,
  };
};
