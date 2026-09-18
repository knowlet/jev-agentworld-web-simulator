import { mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });

const result = await Bun.build({
  entrypoints: ['ui/App.tsx'],
  outdir: 'dist/assets',
  target: 'browser',
  format: 'esm',
  minify: true,
  naming: 'app.[ext]',
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error('Bun.build failed');
}
await Bun.write('dist/index.html', Bun.file('ui/index.html'));
