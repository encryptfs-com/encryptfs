import assert from 'node:assert/strict';
import test from 'node:test';
import { CHUNK_SIZE, encrypt } from '../dist/lib/format.js';

test('video worker streams authenticated ranges and isolates the owning tab', async () => {
  const listeners = new Map();
  let clientRequests = 0;
  globalThis.self = {
    registration: { scope: 'https://example.test/' },
    location: { origin: 'https://example.test' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    clients: {
      async get(id) {
        assert.equal(id, 'owner');
        return {
          postMessage({ token }, [port]) {
            clientRequests++;
            assert.equal(token, 'token');
            self.onmessage({ data: { action: 'open-video-reader', payload: { id: 'vault', index: 0, token, port, type: 'video/quicktime' } } });
          }
        };
      }
    }
  };
  try {
    await import('../dist/video-preview-worker.js');
    await import('../dist/crypto-worker.js');
    const bytes = Uint8Array.from({ length: CHUNK_SIZE + 8 }, (_, index) => index % 251);
    const file = await encrypt([{ path: 'video.mov', blob: new Blob([bytes]) }], 'test password');
    self.postMessage = data => assert.ok(data.progress || data.result);
    await self.onmessage({ data: { action: 'unlock', payload: { id: 'vault', file, password: 'test password' } } });

    function request(range, clientId = 'owner', destination = 'video') {
      return new Promise(resolve => listeners.get('fetch')({
        clientId,
        request: {
          url: 'https://example.test/__video-preview__/owner/token',
          method: 'GET',
          destination,
          headers: new Headers({ Range: range })
        },
        respondWith: resolve
      }));
    }

    const probe = await request('bytes=0-1');
    assert.equal(probe.status, 206);
    assert.equal(probe.headers.get('Content-Range'), `bytes 0-1/${bytes.length}`);
    assert.equal(probe.headers.get('Content-Type'), 'video/quicktime');
    assert.equal(probe.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(new Uint8Array(await probe.arrayBuffer()), bytes.slice(0, 2));

    const seek = await request(`bytes=${CHUNK_SIZE - 2}-`);
    assert.equal(seek.headers.get('Content-Length'), '10');
    assert.deepEqual(new Uint8Array(await seek.arrayBuffer()), bytes.slice(-10));

    const suffix = await request('bytes=-4', '');
    assert.deepEqual(new Uint8Array(await suffix.arrayBuffer()), bytes.slice(-4));

    const invalid = await request(`bytes=${bytes.length}-`);
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('Content-Range'), `bytes */${bytes.length}`);
    assert.equal((await request('bytes=0-1', 'other')).status, 404);
    assert.equal((await request('bytes=0-1', 'owner', 'document')).status, 404);
    assert.equal(clientRequests, 4);
  } finally {
    self.onmessage?.({ data: { action: 'release', payload: { id: 'vault' } } });
    delete globalThis.self;
  }
});
