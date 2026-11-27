import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDriveConfigured } from '../dist/lib/google-drive.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const withDrive = process.argv.includes('--with-google-drive');
const { GOOGLE_DRIVE_CONFIG: trackedConfig } = await import('../dist/drive-config.js');
if (Object.values(trackedConfig).some(Boolean)) throw new Error('Keep the tracked Drive configuration blank.');
let driveConfig;
if (withDrive) {
  const { GOOGLE_DRIVE_CONFIG } = await import('../drive-config.local.js');
  if (!isDriveConfigured(GOOGLE_DRIVE_CONFIG)) throw new Error('Set the three public Drive settings before staging.');
  const { clientId, apiKey, appId } = GOOGLE_DRIVE_CONFIG;
  driveConfig = { clientId, apiKey, appId: String(appId) };
}

const stage = await mkdtemp(join(tmpdir(), 'encryptfs-pages-'));
await cp(join(root, 'dist'), stage, { recursive: true, filter: source => basename(source) !== '.DS_Store' });
if (driveConfig) {
  const module = `export const GOOGLE_DRIVE_CONFIG = Object.freeze(${JSON.stringify(driveConfig, null, 2)});\n`;
  await writeFile(join(stage, 'drive-config.js'), module);
}
console.log(stage);
