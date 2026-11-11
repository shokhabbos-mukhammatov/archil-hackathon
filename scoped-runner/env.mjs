// Loads settings from an env file, if there is one, before anything else reads them.
// Looks for ".env" and ".env.txt" (Windows often adds the .txt) in this folder and its parent.
// Variables already set in the terminal win, empty values are skipped, and no value is
// ever printed: only the variable names.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  const loaded = [];
  for (const dir of [here, path.dirname(here)]) {
    for (const name of ['.env', '.env.txt']) {
      const file = path.join(dir, name);
      if (!existsSync(file)) continue;
      for (const raw of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!match) continue;
        const key = match[1];
        const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        if (!value || process.env[key]) continue;
        process.env[key] = value;
        loaded.push(key);
      }
      if (loaded.length) return { file, loaded };
    }
  }
  return { file: null, loaded };
}

const result = loadEnv();
if (result.file) console.log(`Settings loaded from ${path.basename(result.file)}: ${result.loaded.join(', ')}`);
