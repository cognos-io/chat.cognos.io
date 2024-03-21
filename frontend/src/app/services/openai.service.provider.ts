import OpenAI from 'openai';

import { environment } from '@environments/environment';

const openAiFactory = () => {
  return new OpenAI({
    apiKey: environment.openaiApiKey,
  });
};

export const provideOpenAi = () => {
  return {
    provide: OpenAI,
    useFactory: openAiFactory,
  };
};
