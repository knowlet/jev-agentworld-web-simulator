import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { canonicalUrl, normalizePage, pageDraftSchema, type PageDraft } from '../src/domain';
import { loadConfig, namespace } from '../src/config';
import { Store } from '../src/store';
import { Providers } from '../src/providers';
import { World } from '../src/world';
import { createApp, listen } from '../src/server';
import { compilePage } from '../ui/catalog';
import { WorldView } from '../ui/registry';

const config = () => loadConfig({ APP_MODE: 'mock', WORLD_DB: ':memory:' });
const fixture: PageDraft = {
  title: 'Deep sea', siteName: 'Atlas', summary: 'A fictional ocean archive.', imageAlt: '',
  sections: [{ heading: 'Overview', kind: 'text', body: 'A specific overview.' }, { heading: 'Details', kind: 'code', body: 'const sea = true;' }],
  links: [1, 2, 3].map(i => ({ label: `Topic ${i}`, url: `/topic-${i}` })),
};
const policy = { layout: 'article', palette: 'blue', confidence: 0.9, source: 'jev' } as const;
function harness() {
  const c = config(); const store = new Store(':memory:', namespace(c));
  const providers = new Providers(c, async () => { throw new Error('Network forbidden in fixture mode'); });
  return { store, providers, world: new World(store, providers) };
}
function liveProvider(handler: (url: string, body: any, init: RequestInit) => Response | Promise<Response>) {
  const c = { ...config(), mode: 'live' as const, jevKey: 'private-jev-key', key: 'private-openai-key' };
  return new Providers(c, async (url, init) => handler(String(url), JSON.parse(String(init?.body)), init!));
}
function choiceResponse(questions: Record<string, { criteria: Record<string, unknown> }>) {
  return { answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const options = Object.keys(q.criteria);
    return [id, { type: 'choice', choice: options[0], confidence: 1,
      probabilities: Object.fromEntries(options.map((o, i) => [o, i === 0 ? 1 : 0])) }];
  })) };
}

test('canonicalization retains query semantics and removes fragments', () => {
  assert.equal(canonicalUrl('https://EXAMPLE.org:443/a?q=1#section'), 'https://example.org/a?q=1');
  assert.equal(canonicalUrl('../next', 'https://example.org/docs/start'), 'https://example.org/next');
});
for (const url of ['javascript:alert(1)', 'data:text/html,abc', 'file:///etc/passwd', 'https://user:pass@example.org', 'https://a.org/\nadmin', 'https://a.org/with space', 'https://a.org/\\evil', 'http://localhost', '']) {
  test(`reject unsafe or invalid URL ${JSON.stringify(url)}`, () => assert.throws(() => canonicalUrl(url)));
}
test('page schema rejects executable extra fields and dead ends', () => {
  assert.equal(pageDraftSchema.safeParse({ ...fixture, script: 'alert(1)' }).success, false);
  assert.throws(() => normalizePage({ ...fixture, links: fixture.links.map(l => ({ ...l, url: '/same' })) }, 'https://a.org/same', policy));
});
test('model fields render as escaped text, never markup', () => {
  const page = normalizePage({ ...fixture, title: '<script>alert(1)</script>', sections: fixture.sections.map(s => ({ ...s, body: '<img src=x onerror=alert(1)>' })) }, 'https://a.org/', policy);
  const html = renderToStaticMarkup(createElement(WorldView, { spec: compilePage(page) }));
  assert(!html.includes('<script>')); assert(!html.includes('<img src='));
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('/view?')); assert(!html.includes('href="https://'));
});
test('all five layout policies compile and render through json-render', () => {
  for (const layout of ['article', 'docs', 'forum', 'product', 'home'] as const) {
    const page = normalizePage(fixture, 'https://a.org/', { ...policy, layout });
    assert(renderToStaticMarkup(createElement(WorldView, { spec: compilePage(page) })).includes(`layout-${layout}`));
  }
});
test('live mode fails configuration without Jev credentials; never auto-mocks', () => {
  assert.throws(() => loadConfig({}), /JEV_API_KEY/);
  assert.equal(loadConfig({ TYPESAFE_API_KEY: 'private' }).mode, 'live');
  assert.throws(() => loadConfig({ APP_MODE: 'mock', OPENAI_JSON_MODE: 'typo' }));
});
test('world namespaces separate fixture/live, epochs and models, not credentials', () => {
  const c = config();
  assert.notEqual(namespace(c), namespace({ ...c, mode: 'live' }));
  assert.notEqual(namespace(c), namespace({ ...c, epoch: '2' }));
  assert.notEqual(namespace(c), namespace({ ...c, model: 'other' }));
  assert.equal(namespace(c), namespace({ ...c, key: 'rotated' }));
});
test('SQLite persistence is stable across restarts and does not overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'world-'));
  try {
    const path = join(dir, 'world.sqlite');
    const a = new Store(path, 'one'); a.put('page', 'a', { title: 'first' }); a.close();
    const b = new Store(path, 'one'); assert.deepEqual(b.put('page', 'a', { title: 'second' }), { title: 'first' }); b.close();
    const c = new Store(path, 'two'); assert.equal(c.get('page', 'a'), undefined); c.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('complete fixture search → page → link loop uses no upstream calls', async () => {
  const { store, world, providers } = harness();
  try {
    const search = await world.search('deep sea');
    const first = await world.page(search.data.results[0].url);
    const second = await world.page(first.data.links[0].url, first.data.url, first.data.links[0].label);
    assert.notEqual(first.data.url, second.data.url);
    assert.equal(second.data.siteName, first.data.siteName);
    assert.equal((await world.page(first.data.url)).cached, true);
    assert.deepEqual((await world.page(first.data.url)).data, first.data);
    assert.equal(providers.calls.length, 0);
  } finally { store.close(); }
});
test('Jev HTTP request uses documented /systemone Choice contract', async () => {
  const p = liveProvider((url, body, init) => {
    assert(url.endsWith('/systemone'));
    assert.equal(body.model, 'jev-latest'); assert.equal(body.questions.layout.type, 'choice');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer private-jev-key');
    assert.equal(init.redirect, 'error');
    return Response.json(choiceResponse(body.questions));
  });
  assert.equal((await p.pagePolicy({ url: 'https://a.org/' })).source, 'jev');
});
test('Jev rejects invalid and out-of-catalog answers instead of fallback', async () => {
  const p = liveProvider(() => Response.json({ answers: { layout: { type: 'choice', choice: 'execute_js', confidence: 1, probabilities: { execute_js: 1 } } } }));
  await assert.rejects(p.pagePolicy({ url: 'https://a.org/' }), /out-of-catalog/);
});
test('OpenAI-compatible generation sends JSON mode and optional thinking without Qwen prefill', async () => {
  const p = liveProvider((url, body) => {
    assert(url.endsWith('/chat/completions'));
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.stream, false); assert.equal(body.messages.length, 2);
    assert.equal(body.thinking, undefined); assert.equal(body.seed, undefined);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixture) } }] });
  });
  assert.equal((await p.page({ url: 'https://a.org/' }, policy)).title, fixture.title);
});
for (const mode of ['off', 'json_schema'] as const) {
  test(`generator supports explicit ${mode} mode`, async () => {
    const p = liveProvider((_url, body) => {
      assert.equal(body.response_format?.type, mode === 'off' ? undefined : 'json_schema');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixture) } }] });
    });
    p.config.jsonMode = mode; await p.page({ url: 'https://a.org/' }, policy);
  });
}
test('truncated generation is rejected and not tolerated as a completed document', async () => {
  const p = liveProvider(() => Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(fixture) } }] }));
  await assert.rejects(p.page({ url: 'https://a.org/' }, policy), /did not finish/);
});
test('authentication errors are not retried and never echo secret bodies', async () => {
  let calls = 0;
  const p = liveProvider(() => { calls++; return new Response('private-openai-key leaked by upstream', { status: 401 }); });
  await assert.rejects(p.page({ url: 'https://a.org/' }, policy), e => {
    assert(!String(e).includes('private-openai-key')); return true;
  });
  assert.equal(calls, 1);
});
test('overload retry is bounded to one additional attempt', async () => {
  let calls = 0;
  const p = liveProvider((_url, body) => ++calls === 1 ? new Response('', { status: 529 }) : Response.json(choiceResponse(body.questions)));
  await p.pagePolicy({ url: 'https://a.org/' }); assert.equal(calls, 2);
});
test('simultaneous cache misses share generation; a failure remains retryable', async () => {
  let calls = 0; let fail = true;
  const p = new Providers({ ...config(), mode: 'live' });
  p.pagePolicy = async () => policy;
  p.page = async () => { calls++; await new Promise(r => setTimeout(r, 10)); if (fail) throw new Error('fixture failure'); return fixture; };
  const store = new Store(':memory:', 'dedup'); const world = new World(store, p);
  try {
    const results = await Promise.allSettled([world.page('https://a.org/'), world.page('https://a.org/')]);
    assert(results.every(r => r.status === 'rejected')); assert.equal(calls, 1); assert.equal(store.stats().page, undefined);
    fail = false;
    const successes = await Promise.all([world.page('https://a.org/'), world.page('https://a.org/')]);
    assert.equal(calls, 2); assert.deepEqual(successes[0].data, successes[1].data);
  } finally { store.close(); }
});
test('HTTP API validates inputs, denies cross-origin calls and does not expose settings', async () => {
  const { store, world } = harness(); const app = createApp(world); const base = await listen(app, 0);
  try {
    const post = (path: string, data: unknown, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    assert.equal((await post('/api/page', { url: 'javascript:alert(1)' })).status, 400);
    assert.equal((await post('/api/page', { url: 'https://a.org/', baseUrl: 'https://evil.org' })).status, 400);
    assert.equal((await post('/api/search', { query: 'test' }, { Origin: 'https://evil.org' })).status, 403);
    assert.equal((await fetch(base + '/settings')).status, 404);
    const result = await post('/api/search', { query: 'deep sea' }); assert.equal(result.status, 200);
    assert.equal((await result.json()).mode, 'mock');
    const health = await fetch(base + '/api/health');
    assert(health.headers.get('content-security-policy')?.includes("script-src 'self'"));
    assert.equal((await health.json()).upstreamConnectivity, 'not-probed');
  } finally { await new Promise<void>(resolve => app.close(() => resolve())); store.close(); }
});
