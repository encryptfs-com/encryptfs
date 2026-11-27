import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve('.');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
export async function serve(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const test = pathname.startsWith('/tests/');
    const base = path.join(root, test ? 'tests' : 'dist');
    const relative = test ? pathname.slice(7) : pathname.slice(1);
    let file = path.resolve(base, relative || 'index.html');
    if (!file.startsWith(base + path.sep) && file !== base) throw new Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); response.end(data);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  http.createServer(serve).listen(port, '127.0.0.1', () => console.log(`encryptfs: http://127.0.0.1:${port}`));
}
