// Small JSON settings file. Secrets are encrypted with Electron safeStorage (passed in as `crypto`).
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createSettings({ dir, crypto }) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'settings.json');
  let data = {};
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { data = {}; }
  if (!data.secrets) data.secrets = {};

  const save = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  };

  return {
    get: key => data[key],
    set(key, value) { data[key] = value; save(); },
    getSecret(key) {
      const enc = data.secrets[key];
      if (!enc || !crypto.isEncryptionAvailable()) return null;
      try { return crypto.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
    },
    setSecret(key, value) {
      if (value == null) delete data.secrets[key];
      else if (crypto.isEncryptionAvailable()) data.secrets[key] = crypto.encryptString(value).toString('base64');
      else return; // never store a session in plain text
      save();
    },
    clearSecrets(prefix) {
      for (const key of Object.keys(data.secrets)) if (key.startsWith(prefix)) delete data.secrets[key];
      save();
    },
  };
}
