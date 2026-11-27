import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPdfPreview } from '../dist/lib/pdf-preview.js';
import { pdfFixture } from './preview-fixtures.js';

// Optional native canvas permits real PDF rasterization in Node. Browser tests
// exercise the same viewer in a browser without this development-only dependency.
let canvasLibrary;
try { canvasLibrary = createRequire(import.meta.url)('@napi-rs/canvas'); } catch {}
test('PDF preview renders real pixels and navigates pages', { skip: !canvasLibrary && 'Optional @napi-rs/canvas is not installed' }, async () => {
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) globalThis[name] ??= canvasLibrary[name];
  let canvas; const nodes = [];
  const document = { createElement(tag) {
    const node = tag === 'canvas' ? canvasLibrary.createCanvas(1, 1) : {};
    node.className = ''; node.dataset = {}; node.children = []; node.setAttribute = () => {};
    node.append = (...children) => node.children.push(...children);
    if (tag === 'canvas') canvas = node;
    nodes.push(node); return node;
  } };
  const content = { ownerDocument: document, clientWidth: 400, replaceChildren() {} };
  let status;
  const viewer = createPdfPreview(pdfFixture(), content, { active: () => true, onStatus: value => status = value });
  try {
    await viewer.ready;
    assert.equal(canvas.dataset.rendered, 'true');
    const first = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    assert.ok(first[2] > first[0], 'First page should contain the blue rectangle');
    nodes.find(node => node.textContent === '→').onclick();
    const deadline = Date.now() + 3000;
    while (canvas.dataset.rendered !== 'true' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const second = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    assert.ok(second[0] > second[2], 'Second page should contain the red rectangle');
    assert.match(status, /PDF/);
  } finally { viewer.destroy(); }
});
