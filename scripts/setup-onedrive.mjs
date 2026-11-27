import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
process.chdir(root.pathname);
await mkdir('dist/vendor/msal', { recursive: true });
for (const name of ['auth', 'redirect']) {
  await build({ entryPoints: [`scripts/onedrive/${name}.js`], outfile: `dist/vendor/msal/${name}.js`, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof' });
}
await copyFile('node_modules/@azure/msal-browser/LICENSE', 'dist/vendor/msal/LICENSE');
console.log('OneDrive authentication assets built locally.');
