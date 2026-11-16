// Bundles src/ into a single self-contained "ChessOpeningsTrainer.html".
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  outdir: 'out',
});

const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = result.outputFiles.find((f) => f.path.endsWith('.css')).text;
const icon = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b1e24"/><text x="32" y="47" font-size="42" text-anchor="middle" fill="#8fb4d9">♞</text></svg>');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chess Openings Trainer</title>
<link rel="icon" href="${icon}">
<style>${css}</style>
</head>
<body>
<script>${js}</script>
</body>
</html>
`;

writeFileSync('ChessOpeningsTrainer.html', html);
console.log(`Built "ChessOpeningsTrainer.html" (${Math.round(html.length / 1024)} KB)`);
