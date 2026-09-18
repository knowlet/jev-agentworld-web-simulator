import { canonicalUrl, normalizePage, normalizeSearch, type Context, type Page, type Search, type Result, type Policy, type Site } from './domain';
import { Providers } from './providers';
import { Store, key } from './store';
export type SearchDocument = Search & { query: string; policy: { intent: string; confidence: number; source: 'jev' | 'mock' } };

export class World {
  private flights = new Map<string, Promise<unknown>>();
  private siteTails = new Map<string, Promise<unknown>>();
  constructor(readonly store: Store, readonly providers: Providers) {}
  private async materialize<T>(kind: string, identity: string, generate: () => Promise<T>): Promise<Result<T>> {
    const started = Date.now(); const k = key(identity); const id = `${kind}:${k}`;
    let data = this.store.get<T>(kind, k); let cached = data !== undefined;
    if (data === undefined) {
      let flight = this.flights.get(id) as Promise<T> | undefined;
      if (flight) cached = true;
      else {
        // Register before the first await. Failures are removed, never persisted.
        flight = Promise.resolve().then(generate).then(d => this.store.put(kind, k, d));
        this.flights.set(id, flight);
        void flight.finally(() => { if (this.flights.get(id) === flight) this.flights.delete(id); }).catch(() => {});
      }
      data = await flight;
    }
    return { data, cached, mode: this.providers.config.mode,
      generation: this.providers.config.mode === 'mock' ? 'mock' : 'openai', elapsedMs: Date.now() - started };
  }
  page(urlInput: string, fromInput = '', ctx = ''): Promise<Result<Page>> {
    const url = canonicalUrl(urlInput); const from = fromInput ? canonicalUrl(fromInput) : undefined;
    return this.materialize('page', url, async () => {
      // Serialize first materializations on the same site to establish stable branding.
      const host = new URL(url).hostname;
      const previousTail = this.siteTails.get(host) ?? Promise.resolve();
      const task = previousTail.catch(() => {}).then(async () => {
        const site = this.store.get<Site>('site', host);
        const previous = from ? this.store.get<Page>('page', key(from))?.summary : undefined;
        const context: Context = { url, from, ctx: ctx.slice(0, 200), previous, site };
        const mock = this.providers.config.mode === 'mock';
        const policy: Policy = mock ? { layout: 'article', palette: 'blue', confidence: 1, source: 'mock' }
          : await this.providers.pagePolicy(context);
        const draft = mock ? {
          title: ctx || decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || host),
          siteName: host, summary: `A fictional observation at ${url}.`, imageAlt: 'Simulated scene — no external image loaded',
          sections: [
            { heading: 'Overview', kind: 'text' as const, body: `This is a deterministic MOCK fixture for ${url}. No model has been called.` },
            { heading: 'Explore this world', kind: 'text' as const, body: previous || 'Every link stays inside the simulator and materializes another fictional page.' },
          ],
          links: [1, 2, 3, 4].map(i => ({ label: `Explore topic ${i}`, url: `${url.replace(/\?.*$/, '').replace(/\/$/, '')}/topic-${i}` })),
        } : await this.providers.page(context, policy);
        const page = normalizePage(draft, url, policy, site);
        const savedSite = this.store.put('site', host, { name: page.siteName, palette: page.policy.palette });
        return { ...page, siteName: savedSite.name, policy: { ...page.policy, palette: savedSite.palette } };
      });
      this.siteTails.set(host, task);
      try { return await task; }
      finally { if (this.siteTails.get(host) === task) this.siteTails.delete(host); }
    });
  }
  search(input: string): Promise<Result<SearchDocument>> {
    const query = input.trim().replace(/\s+/g, ' ');
    if (!query || query.length > 500) throw new Error('Search must contain 1–500 characters');
    return this.materialize('search', query, async () => {
      const mock = this.providers.config.mode === 'mock';
      const policy = mock ? { intent: 'general', confidence: 1, source: 'mock' as const } : await this.providers.searchPolicy(query);
      const draft = mock ? {
        results: ['atlas', 'journal', 'forum', 'archive', 'guide', 'lab'].map((host, i) => ({
          title: `${query} — ${host}`, url: `https://${host}.simulated.test/topics/${encodeURIComponent(query)}-${i}`,
          snippet: `MOCK result ${i + 1}: a fictional entry about ${query}.`,
        })), related: [`${query} history`, `${query} examples`],
      } : await this.providers.search(query, policy.intent);
      return { ...normalizeSearch(draft), query, policy };
    });
  }
}
