// PDFs become canvas pixels, not embedded active documents or native plug-ins.
// Load the local renderer only when a PDF is opened.
let library;
async function pdfLibrary() {
  library ??= import('../vendor/pdfjs/pdf.js').then(pdf => {
    pdf.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.js', import.meta.url).href;
    return pdf;
  });
  return library;
}

export function createPdfPreview(blob, content, { active, onStatus }) {
  let closed = false; let loading; let document; let rendering; let pageNumber = 1;
  const current = () => !closed && active();
  const destroy = () => {
    closed = true; rendering?.cancel();
    loading?.destroy().catch(() => {});
  };
  const ready = (async () => {
    const pdf = await pdfLibrary(); if (!current()) return;
    const data = new Uint8Array(await blob.arrayBuffer()); if (!current()) { data.fill(0); return; }
    loading = pdf.getDocument({ data, isEvalSupported: false, enableXfa: false, useWasm: false,
      useWorkerFetch: false, maxImageSize: 16 * 1024 * 1024, canvasMaxAreaInBytes: 32 * 1024 * 1024,
      cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href });
    document = await loading.promise; if (!current()) return;
    const doc = content.ownerDocument;
    const viewer = doc.createElement('div'); viewer.className = 'pdf-preview';
    const toolbar = doc.createElement('div'); toolbar.className = 'pdf-navigation';
    const previous = doc.createElement('button'); previous.type = 'button'; previous.textContent = '←'; previous.setAttribute('aria-label', 'Previous PDF page');
    const next = doc.createElement('button'); next.type = 'button'; next.textContent = '→'; next.setAttribute('aria-label', 'Next PDF page');
    const label = doc.createElement('span'); label.setAttribute('aria-live', 'polite');
    const canvas = doc.createElement('canvas'); canvas.setAttribute('role', 'img');
    toolbar.append(previous, label, next); viewer.append(toolbar, canvas); content.replaceChildren(viewer);
    async function render() {
      if (!current()) return;
      previous.disabled = true; next.disabled = true;
      canvas.dataset.rendered = 'false';
      label.textContent = `Page ${pageNumber} of ${document.numPages}`;
      onStatus(`Rendering page ${pageNumber}…`);
      const page = await document.getPage(pageNumber); if (!current()) return;
      const original = page.getViewport({ scale: 1 });
      const width = Math.max(160, Math.min(content.clientWidth - 28, 850));
      const desiredScale = width / original.width * Math.min(globalThis.devicePixelRatio || 1, 2);
      const scale = Math.min(desiredScale, Math.sqrt(4 * 1024 * 1024 / (original.width * original.height)));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
      canvas.setAttribute('aria-label', `PDF page ${pageNumber} of ${document.numPages}`);
      canvas.dataset.rendered = 'false';
      rendering = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
      await rendering.promise; if (!current()) return;
      canvas.dataset.rendered = 'true'; previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= document.numPages;
      onStatus(`PDF · ${document.numPages} ${document.numPages === 1 ? 'page' : 'pages'}`);
      page.cleanup();
    }
    const fail = error => { if (current()) { onStatus(`PDF preview failed: ${error.message}. Download the file to view it.`); } };
    previous.onclick = () => { if (pageNumber > 1) { pageNumber--; render().catch(fail); } };
    next.onclick = () => { if (pageNumber < document.numPages) { pageNumber++; render().catch(fail); } };
    await render();
  })();
  return { ready, destroy };
}
