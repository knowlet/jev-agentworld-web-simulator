import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { loadConfig, namespace } from '../src/config';
import { Providers } from '../src/providers';
import { Store } from '../src/store';
import { World } from '../src/world';
import { createApp, listen } from '../src/server';
import { viewHref } from '../src/domain';

await mkdir('reports', { recursive: true });
const report: Record<string, unknown> = { mode: 'live', startedAt: new Date().toISOString(), status: 'failed', checks: [] };
const checks = report.checks as string[];
let store: Store | undefined;
let app: ReturnType<typeof createApp> | undefined;
let providers: Providers | undefined;
try {
  const config = loadConfig({ ...process.env, APP_MODE: 'live' });
  report.models = { jev: config.jevModel, generator: config.model, jsonMode: config.jsonMode };
  // A fresh namespace prevents earlier runs from masquerading as live validation.
  store = new Store(':memory:', namespace(config) + '-smoke');
  providers = new Providers(config);
  const world = new World(store, providers);
  app = createApp(world); const base = await listen(app, 0);
  const request = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Local HTTP ${res.status}`);
    assert.equal(result.mode, 'live'); assert.equal(result.generation, 'openai');
    assert.equal(result.data.policy.source, 'jev');
    return result;
  };
  const search = await request('/api/search', { query: process.env.LIVE_QUERY || 'deep sea exploration' });
  checks.push('Live Jev search intent and generator search document');
  const first = await request('/api/page', { url: search.data.results[0].url, ctx: search.data.results[0].title });
  checks.push('Live Jev page policy and generator page document');
  const next = first.data.links[0];
  const second = await request('/api/page', { url: next.url, from: first.data.url, ctx: next.label });
  assert.notEqual(second.data.url, first.data.url);
  checks.push('Following a generated link materializes a different page');
  const callsBefore = providers.calls.length;
  const cached = await request('/api/page', { url: first.data.url });
  assert.equal(cached.cached, true); assert.deepEqual(cached.data, first.data);
  assert.equal(providers.calls.length, callsBefore);
  checks.push('Revisit is stable and performs zero additional provider calls');
  assert.equal(providers.calls.filter(c => c.provider === 'jev').length, 3);
  assert.equal(providers.calls.filter(c => c.provider === 'openai').length, 3);
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
  checks.push('Production UI renders the live cached page in Chromium');
  report.status = 'passed';
} catch (error) {
  // Our HTTP layer exposes sanitized provider errors, never response bodies/keys.
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
