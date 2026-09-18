import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/assets', { recursive: true });
await build({ entryPoints: ['ui/App.tsx'], bundle: true, minify: true, format: 'esm',
  platform: 'browser', target: 'es2022', outfile: 'dist/assets/app.js', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' } });
await copyFile('ui/index.html', 'dist/index.html');
