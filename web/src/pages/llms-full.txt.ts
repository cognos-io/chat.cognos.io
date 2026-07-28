// Every English page in one file at /llms-full.txt.
import { llmsFull } from '../lib/llms';

export function GET() {
  return new Response(llmsFull('en'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
