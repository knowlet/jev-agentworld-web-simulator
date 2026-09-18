import { z } from 'zod';

export const VERSION = 'page-v1';
export const layouts = ['article', 'docs', 'forum', 'product', 'home'] as const;
export const palettes = ['neutral', 'blue', 'warm', 'dark'] as const;
export const intents = ['research', 'howto', 'comparison', 'discussion', 'general'] as const;
const text = (n: number) => z.string().trim().min(1).max(n);
export const linkSchema = z.strictObject({ label: text(200), url: text(2048) });
export const pageDraftSchema = z.strictObject({
  title: text(200), siteName: text(100), summary: text(600),
  imageAlt: z.string().max(160),
  sections: z.array(z.strictObject({
    heading: text(160), kind: z.enum(['text', 'code', 'quote']), body: text(5000),
  })).min(2).max(12),
  links: z.array(linkSchema).min(3).max(16),
});
export const searchSchema = z.strictObject({
  results: z.array(z.strictObject({ title: text(200), url: text(2048), snippet: text(700) })).min(4).max(9),
  related: z.array(text(180)).min(1).max(4),
});
export const policySchema = z.strictObject({
  layout: z.enum(layouts), palette: z.enum(palettes),
  confidence: z.number().min(0).max(1), source: z.enum(['jev', 'mock']),
});
export const pageSchema = pageDraftSchema.extend({ url: text(2048), policy: policySchema });
export type PageDraft = z.infer<typeof pageDraftSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Search = z.infer<typeof searchSchema>;
export type Policy = z.infer<typeof policySchema>;
export interface Site { name: string; palette: Policy['palette'] }
export interface Context { url: string; from?: string; ctx?: string; previous?: string; site?: Site }
export interface Result<T> { data: T; cached: boolean; mode: 'live' | 'mock'; generation: 'openai' | 'mock'; elapsedMs: number }

// These are world identifiers, never fetch targets. No scheme-relative, credentials,
// executable schemes, control characters, or ambiguous single-label destinations.
export function canonicalUrl(raw: string, base?: string): string {
  if (!raw || raw.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(raw)) throw new Error('Invalid simulated URL');
  const value = base ? raw : (/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  const u = new URL(value, base);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.hostname.includes('.')) {
    throw new Error('Use an http(s) URL without credentials');
  }
  u.hash = '';
  return u.href;
}
export function normalizePage(draft: PageDraft, url: string, policy: Policy, site?: Site): Page {
  const seen = new Set<string>();
  const links = draft.links.map(l => ({ ...l, url: canonicalUrl(l.url, url) })).filter(l => {
    if (l.url === url || seen.has(l.url)) return false;
    seen.add(l.url); return true;
  });
  // Never persist an unusable/dead-end page. Reload can retry a failed generation.
  return pageSchema.parse({ ...draft, siteName: site?.name ?? draft.siteName, url, links,
    policy: { ...policy, palette: site?.palette ?? policy.palette } });
}
export function normalizeSearch(draft: Search): Search {
  const seen = new Set<string>();
  return searchSchema.parse({ ...draft, results: draft.results.map(r => ({ ...r, url: canonicalUrl(r.url) }))
    .filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; }) });
}
export function viewHref(url: string, from = '', ctx = ''): string {
  return '/view?' + new URLSearchParams({ url: canonicalUrl(url), from, ctx }).toString();
}
