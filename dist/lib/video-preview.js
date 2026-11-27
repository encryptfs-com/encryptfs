const script = new URL('../video-preview-worker.js', import.meta.url);
const scope = new URL('./', script);

export function videoType(entry) {
  const types = ['video/mp4', 'video/quicktime', 'video/webm'];
  if (types.includes(entry.type)) return entry.type;
  const extension = entry.path.split('.').pop().toLowerCase();
  return new Map([
    ['mp4', 'video/mp4'], ['m4v', 'video/mp4'],
    ['mov', 'video/quicktime'], ['webm', 'video/webm']
  ]).get(extension);
}

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The browser did not start the video preview worker.')), 10000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function openVideoPreview(worker, { id, index, type }, signal, onError) {
  const service = navigator.serviceWorker;
  if (!service) throw new Error('This browser cannot start on-demand preview.');
  let registration;
  let controller;
  const changed = new AbortController();
  try {
    registration = await withTimeout(service.register(script, { scope: scope.href }));
    await withTimeout(new Promise(resolve => {
      function check() {
        if (service.controller?.scriptURL === script.href) {
          controller = service.controller;
          resolve();
        }
      }
      service.addEventListener('controllerchange', check, { signal: changed.signal });
      check();
    }));
  } finally {
    changed.abort();
  }
  signal.throwIfAborted();

  const { port1, port2 } = new MessageChannel();
  let clientId;
  try {
    clientId = await withTimeout(new Promise(resolve => {
      port1.onmessage = ({ data }) => resolve(data);
      controller.postMessage('identify-video-client', [port2]);
    }));
  } finally {
    port1.close();
  }
  signal.throwIfAborted();
  if (!clientId || service.controller !== controller) throw new Error('Reload the page to start on-demand preview.');

  const token = crypto.randomUUID();
  worker.addEventListener('message', ({ data }) => {
    if (data.videoPreviewError?.token === token) onError(data.videoPreviewError.message);
  }, { signal });
  service.addEventListener('message', event => {
    const port = event.ports[0];
    if (event.source !== controller || event.data?.action !== 'read-video-preview' ||
        event.data.token !== token || !port) return;
    worker.postMessage({ action: 'open-video-reader', payload: { id, index, token, type, port } }, [port]);
  }, { signal });

  signal.addEventListener('abort', () => worker.postMessage({ action: 'close-video', payload: { token } }), { once: true });
  return new URL(`__video-preview__/${clientId}/${token}`, registration.scope).href;
}
