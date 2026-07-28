// English index at /llms.txt (https://llmstxt.org/).
import { llmsIndex } from '../lib/llms';

export function GET() {
  return new Response(llmsIndex('en'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
