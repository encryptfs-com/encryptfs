Object.defineProperty(window, 'Worker', { configurable: true, value: undefined });
await import('/app.js');
parent.postMessage({ type: 'unsupported-test', visible: !document.getElementById('unsupported').hidden && document.getElementById('workspace').hidden }, location.origin);
