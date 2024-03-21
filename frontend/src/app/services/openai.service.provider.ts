import OpenAI from 'openai';

const openAiFactory = () => {
  return new OpenAI({
    apiKey: '',
  });
};

export const provideOpenAi = () => {
  return {
    provide: OpenAI,
    useFactory: openAiFactory,
  };
};
