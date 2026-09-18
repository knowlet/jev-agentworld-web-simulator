import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { loadConfig, namespace } from '../src/config';
import { Providers } from '../src/providers';
import { Store } from '../src/store';
import { World } from '../src/world';
import { createApp, listen } from '../src/server';
import { viewHref } from '../src/domain';
import { JSON_RENDER_UPSTREAM } from '../src/composer';

await mkdir('reports', { recursive: true });
const report: Record<string, unknown> = { mode: 'live', startedAt: new Date().toISOString(), status: 'failed', checks: [], jsonRenderUpstream: JSON_RENDER_UPSTREAM };
const checks = report.checks as string[];
let store: Store | undefined;
let app: ReturnType<typeof createApp> | undefined;
let providers: Providers | undefined;
try {
  const config = loadConfig({ ...process.env, APP_MODE: 'live' });
  report.models = { jevGateway: config.jevModel, generator: config.model, jsonMode: config.jsonMode };
  store = new Store(':memory:', namespace(config) + '-smoke');
  providers = new Providers(config);
  const world = new World(store, providers);
  app = createApp(world); const base = await listen(app, 0);
  const request = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Local HTTP ${res.status}`);
    assert.equal(result.mode, 'live'); assert.equal(result.generation, 'openai');
    assert.equal(result.data.policy.source, 'jev'); assert.equal(result.composition.source, 'json-render-jev');
    assert.equal(result.composition.stopReason, 'finish'); assert(result.spec?.root);
    return result;
  };
  const search = await request('/api/search', { query: process.env.LIVE_QUERY || 'deep sea exploration' });
  checks.push('Gateway Jev search intent + generator + official json-render Jev composition');
  const first = await request('/api/page', { url: search.data.results[0].url, ctx: search.data.results[0].title });
  checks.push('Gateway Jev page policy + generator + official json-render Jev composition');
  const next = first.data.links[0];
  const second = await request('/api/page', { url: next.url, from: first.data.url, ctx: next.label });
  assert.notEqual(second.data.url, first.data.url);
  checks.push('Following a generated link materializes a different composed page');
  const callsBefore = providers.calls.length;
  const cached = await request('/api/page', { url: first.data.url });
  assert.equal(cached.cached, true); assert.deepEqual(cached.data, first.data); assert.deepEqual(cached.spec, first.spec);
  assert.equal(providers.calls.length, callsBefore);
  checks.push('Revisit is stable and performs zero additional provider/evaluator calls');
  assert.equal(providers.calls.filter(c => c.provider === 'openai').length, 3);
  assert(providers.calls.filter(c => c.provider === 'jev-gateway').length >= 6);
  report.observations = { search, first, second, fictional: true };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage(); const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + viewHref(first.data.url));
    await page.getByRole('heading', { name: first.data.title, exact: true, level: 1 }).waitFor();
    await page.screenshot({ path: 'reports/live-page.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  checks.push('Production UI renders the cached official-composer spec in Chromium');
  report.status = 'passed';
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Live validation failed';
  process.exitCode = 1;
} finally {
  report.calls = providers?.calls ?? [];
  report.finishedAt = new Date().toISOString();
  await writeFile('reports/live.json', JSON.stringify(report, null, 2));
  await writeFile('reports/live.md', `# Live smoke: ${report.status}\n\n${checks.map(c => `- PASS: ${c}`).join('\n')}\n\n${report.error ? `Error: ${report.error}\n` : ''}\nGenerated observations are fictional. This is an integration smoke test, not a factuality or world-model quality benchmark.\n`);
  if (app) await new Promise<void>(resolve => { app!.close(() => resolve()); app!.closeIdleConnections(); });
  store?.close();
}
