addEventListener('fetch', event => event.respondWith(handleRequest(event.request)));

const VERSION = '1.0.1'; // Worker Contract v1 (HUB-VERSIONING-1)

const HEADERS_JSON = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

async function handleRequest(req) {
  const url = new URL(req.url);
  const p = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
  if (p === '/') return new Response('ops-gateway', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
  if (p === '/health') {
    return new Response(JSON.stringify({ status: 'ok', worker: 'ops-gateway', version: VERSION }), { status: 200, headers: HEADERS_JSON });
  }
  if (p === '/v1/models' && req.method === 'GET') {
    const data = [
      { id: 'gateway/deepseek-v4-pro-0813', object: 'model', description: 'DeepSeek V4 Pro (compat) via Cloudflare AI Gateway', capabilities: ['chat','tool_use','streaming'] },
      { id: 'gateway/@cf/moonshotai/kimi-k2.7-code', object: 'model', description: 'Kimi K2.7 Code via Cloudflare AI Gateway', capabilities: ['chat','code'] },
      { id: 'gateway/openai/gpt-5', object: 'model', description: 'OpenAI GPT-5 (compat) via Cloudflare AI Gateway', capabilities: ['chat','tool_use','streaming'] }
    ];
    return new Response(JSON.stringify({ object: 'list', data }), { status: 200, headers: HEADERS_JSON });
  }
  if ((p === '/v1/chat/completions' || p === '/chat/completions') && req.method === 'POST') {
    const ACCOUNT = 'edb167b78c9fb901ea5bca3ce58ccc4b';
    const ROUTE = 'default';
    const gw = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT}/${ROUTE}/compat/chat/completions`;
    const fwd = await fetch(gw, { method: 'POST', headers: req.headers, body: req.body });
    const outHeaders = new Headers(fwd.headers);
    outHeaders.set('Access-Control-Allow-Origin', '*');
    return new Response(fwd.body, { status: fwd.status, headers: outHeaders });
  }
  return new Response(JSON.stringify({ error: 'not_found', worker: 'ops-gateway' }), { status: 404, headers: HEADERS_JSON });
}
