const starts = (data, signature) => signature.every((value, index) => data[index] === value);
export function formatVideoDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const pad = value => String(value).padStart(2, '0');
  const minutesAndSeconds = `${pad(minutes)}:${pad(total % 60)}`;
  return hours ? `${pad(hours)}:${minutesAndSeconds}` : minutesAndSeconds;
}
export function readVideoDuration(blob, type, signal) {
  if (signal.aborted) return Promise.resolve('');
  return new Promise(resolve => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob.slice(0, blob.size, type));
    function finish(duration = '') {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      video.onloadedmetadata = video.ondurationchange = video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(duration);
    }
    const stop = () => finish();
    const timer = setTimeout(stop, 8000);
    const update = () => {
      const duration = formatVideoDuration(video.duration);
      if (duration) finish(duration);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = video.ondurationchange = update;
    video.onerror = stop;
    signal.addEventListener('abort', stop, { once: true });
    video.src = url;
  });
}
export const previewRenderers = [
  { kind: 'image', match: data => starts(data, [137, 80, 78, 71, 13, 10, 26, 10]), type: 'image/png' },
  { kind: 'image', match: data => starts(data, [255, 216, 255]), type: 'image/jpeg' },
  { kind: 'image', match: (data, text) => /^GIF8[79]a/.test(text), type: 'image/gif' },
  { kind: 'image', match: (data, text) => text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP', type: 'image/webp' },
  { kind: 'pdf', match: (data, text) => text.startsWith('%PDF-'), type: 'application/pdf' },
  { kind: 'video', match: (data, text) => text.slice(4, 8) === 'ftyp', type: 'video/mp4' },
  { kind: 'video', match: data => starts(data, [26, 69, 223, 163]), type: 'video/webm' }
];
export async function detectPreview(blob) {
  const data = new Uint8Array(await blob.slice(0, 8192).arrayBuffer());
  const signature = Array.from(data.slice(0, 32), b => String.fromCharCode(b)).join('');
  const renderer = previewRenderers.find(item => item.match(data, signature));
  if (renderer) return renderer;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: blob.size > data.length });
    if (!/[\x00-\x08\x0b\x0e-\x1f]/u.test(text)) return { kind: 'text', type: 'text/plain' };
  } catch { /* Binary or an unsupported encoding. */ }
  return { kind: 'unsupported', type: 'application/octet-stream' };
}
