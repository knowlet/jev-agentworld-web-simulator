import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import { layouts, palettes } from './domain';

export const catalog = defineCatalog(schema, {
  components: {
    Surface: { props: z.object({ layout: z.enum(layouts), palette: z.enum(palettes) }), slots: ['default'] },
    Header: { props: z.object({ title: z.string(), subtitle: z.string(), brand: z.string() }) },
    Section: { props: z.object({ heading: z.string(), body: z.string(), kind: z.enum(['text', 'code', 'quote']) }) },
    Placeholder: { props: z.object({ alt: z.string() }) },
    Links: { props: z.object({ title: z.string() }), slots: ['default'] },
    Link: { props: z.object({ label: z.string(), href: z.string(), detail: z.string() }) },
  },
  actions: {},
});
