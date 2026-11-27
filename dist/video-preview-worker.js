const prefix = new URL('__video-preview__/', self.registration.scope).pathname;

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data === 'identify-video-client') event.ports[0]?.postMessage(event.source?.id);
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(prefix)) return;
  event.respondWith(serveVideo(event, url.pathname.slice(prefix.length)).catch(() => failure(503)));
});

function failure(status, headers = {}) {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function parseRange(value, size) {
  if (value === null) return { start: 0, end: size };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] && last < size ? last + 1 : size;
  return start < end ? { start, end } : null;
}

async function serveVideo(event, path) {
  const [clientId, token, extra] = path.split('/');
  if (event.request.method !== 'GET' || event.request.destination !== 'video' ||
      !clientId || !token || extra !== undefined || (event.clientId && event.clientId !== clientId)) return failure(404);
  const client = await self.clients.get(clientId);
  if (!client) return failure(404);

  const { port1, port2 } = new MessageChannel();
  let cancelRead;
  function receive(send) {
    return new Promise((resolve, reject) => {
      function finish(error, data) {
        clearTimeout(timer);
        cancelRead = undefined;
        port1.onmessage = null;
        if (error) reject(error);
        else resolve(data);
      }
      const timer = setTimeout(() => finish(new Error('Video read timed out.')), 20000);
      cancelRead = () => finish(new Error('Video read cancelled.'));
      port1.onmessage = ({ data }) => finish(data.error && new Error(data.error), data);
      try { send(); } catch (error) { finish(error); }
    });
  }
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    cancelRead?.();
    port1.postMessage('close');
    port1.close();
  }

  try {
    const { size, chunkSize, type } = await receive(() =>
      client.postMessage({ action: 'read-video-preview', token }, [port2]));
    const header = event.request.headers.get('Range');
    const range = parseRange(header, size);
    if (!range) {
      close();
      return failure(416, { 'Content-Range': `bytes */${size}` });
    }
    let offset = range.start;
    const body = new ReadableStream({
      async pull(controller) {
        const end = Math.min(range.end, offset + chunkSize - offset % chunkSize);
        try {
          const { bytes } = await receive(() => port1.postMessage({ start: offset, end }));
          if (closed) return;
          if (bytes?.byteLength !== end - offset) throw new Error('Short video read.');
          controller.enqueue(bytes);
          offset = end;
          if (offset === range.end) { close(); controller.close(); }
        } catch (error) {
          if (!closed) { close(); controller.error(error); }
        }
      },
      cancel: close
    }, { highWaterMark: 0 });
    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Type': type,
      'Content-Length': String(range.end - range.start),
      'X-Content-Type-Options': 'nosniff'
    };
    if (header !== null) headers['Content-Range'] = `bytes ${range.start}-${range.end - 1}/${size}`;
    return new Response(body, { status: header === null ? 200 : 206, headers });
  } catch (error) {
    close();
    throw error;
  }
}
