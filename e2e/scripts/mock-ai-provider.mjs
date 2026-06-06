import http from 'node:http';

const port = Number(process.env.E2E_AI_MOCK_PORT ?? '18080');

function json(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    console.log(`mock ai provider ${req.method} ${req.url} -> 404`);
    json(res, 404, { error: 'not found' });
    return;
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
  }

  const body = raw ? JSON.parse(raw) : {};
  const maxTokens = body.max_tokens ?? body.max_completion_tokens ?? 0;
  const reply =
    maxTokens > 0 && maxTokens <= 20
      ? 'Mocked conversation title'
      : 'Mocked assistant reply';

  console.log(`mock ai provider ${req.method} ${req.url} -> 200 (${reply})`);

  json(res, 200, {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? 'mock-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: reply,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock ai provider listening on http://127.0.0.1:${port}`);
});
