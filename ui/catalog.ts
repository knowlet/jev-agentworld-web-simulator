import { defineCatalog, type Spec } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import { layouts, palettes, viewHref, type Page, type Search } from '../src/domain';

export const catalog = defineCatalog(schema, {
  components: {
    Surface: { props: z.object({ layout: z.enum(layouts), palette: z.enum(palettes) }), slots: ['default'] },
    Header: { props: z.object({ title: z.string(), subtitle: z.string(), brand: z.string() }) },
    Section: { props: z.object({ heading: z.string(), body: z.string(), kind: z.enum(['text', 'code', 'quote']) }) },
    Placeholder: { props: z.object({ alt: z.string() }) },
    Links: { props: z.object({ title: z.string() }), slots: ['default'] },
    Link: { props: z.object({ label: z.string(), href: z.string(), detail: z.string() }) },
  },
  actions: {}, // Navigation is a fixed, local anchor handler. Models cannot define actions.
});

function builder(layout: typeof layouts[number], palette: typeof palettes[number]) {
  const spec: Spec = { root: 'root', elements: { root: { type: 'Surface', props: { layout, palette }, children: [] } } };
  let n = 0;
  const add = (type: string, props: Record<string, unknown>, parent = 'root') => {
    const id = `e${n++}`;
    spec.elements[id] = { type, props, children: [] };
    spec.elements[parent].children!.push(id);
    return id;
  };
  return { spec, add };
}
export function compilePage(page: Page): Spec {
  const { spec, add } = builder(page.policy.layout, page.policy.palette);
  add('Header', { title: page.title, subtitle: page.summary, brand: page.siteName });
  if (page.imageAlt) add('Placeholder', { alt: page.imageAlt });
  for (const section of page.sections) add('Section', section);
  const group = add('Links', { title: 'Explore this world' });
  for (const link of page.links) add('Link', {
    label: link.label, href: viewHref(link.url, page.url, link.label), detail: new URL(link.url).hostname,
  }, group);
  return spec;
}
export function compileSearch(query: string, data: Search): Spec {
  const { spec, add } = builder('article', 'neutral');
  add('Header', { title: query, subtitle: `${data.results.length} simulated results. These are fictional, not live search results.`, brand: 'AgentWorld Search' });
  const results = add('Links', { title: 'Search results' });
  for (const r of data.results) add('Link', { label: r.title, href: viewHref(r.url, '', r.title), detail: r.snippet }, results);
  const related = add('Links', { title: 'Related searches' });
  for (const q of data.related) add('Link', { label: q, href: '/search?' + new URLSearchParams({ q }), detail: 'Search this simulated world' }, related);
  return spec;
}
