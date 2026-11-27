import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const page = resolve(process.argv[2] ?? 'dist', 'index.html');
const template = /<time id="deployment-time"[^>]*>[^<]*<\/time>/u;
const html = await readFile(page, 'utf8');
if (!template.test(html)) throw new Error('Missing deployment timestamp element.');
const iso = new Date().toISOString();
const label = iso.slice(0, 19).replace('T', ' ');
await writeFile(page, html.replace(template, `<time id="deployment-time" datetime="${iso}">Last updated ${label} UTC</time>`));
