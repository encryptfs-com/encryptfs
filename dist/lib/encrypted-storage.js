// Only encrypted output goes here. Plaintext never enters this temporary store.
// A live tab holds a lock. Later visits can remove files left by a closed tab.
export async function createEncryptedSession(apis = {}) {
  try { return await openEncryptedSession(apis); }
  catch (error) {
    // The worker can assemble ciphertext into a Blob when private storage is unavailable.
    if (['SecurityError', 'NotAllowedError', 'UnknownError', 'QuotaExceededError'].includes(error.name)) return null;
    throw error;
  }
}

async function openEncryptedSession({ storage = globalThis.navigator?.storage, locks = globalThis.navigator?.locks }) {
  if (!storage?.getDirectory || !locks?.request) return null;
  const root = await (await storage.getDirectory()).getDirectoryHandle('encryptfs-encrypted-output', { create: true });
  const id = crypto.randomUUID(); let release;
  const held = new Promise(resolve => { release = resolve; });
  let acquired, failed;
  const ready = new Promise((resolve, reject) => { acquired = resolve; failed = reject; });
  const lease = locks.request(`encryptfs-output-${id}`, async () => { acquired(); await held; });
  lease.catch(failed);
  await ready;
  try {
    for await (const [name] of root.entries()) {
      if (!/^[0-9a-f-]{36}$/u.test(name) || name === id) continue;
      await locks.request(`encryptfs-output-${name}`, { ifAvailable: true }, async lock => {
        if (lock) await root.removeEntry(name, { recursive: true }).catch(() => {});
      });
    }
    const directory = await root.getDirectoryHandle(id, { create: true });
    return { directory, async clear() { try { await root.removeEntry(id, { recursive: true }); } finally { release(); await lease; } } };
  } catch (error) { release(); await lease; throw error; }
}
