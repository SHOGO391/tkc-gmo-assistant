import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

type Check = { id: string; ok: boolean; required: boolean; detail: string };
export function diagnose(dataDirectory = process.env.DATA_DIR ?? 'data') {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({ id: 'node', ok: major >= 24, required: true, detail: process.version });
  try {
    const db = new DatabaseSync(':memory:');
    try {
      const result = db.prepare('SELECT 1 AS healthy').get();
      checks.push({ id: 'sqlite', ok: result?.healthy === 1, required: true, detail: 'in-memory only' });
    } finally { db.close(); }
  } catch {
    checks.push({ id: 'sqlite', ok: false, required: true, detail: 'SQLite runtime unavailable' });
  }
  const require = createRequire(import.meta.url);
  for (const dependency of ['express', 'csv-parse', 'iconv-lite', 'playwright']) {
    try {
      require(dependency);
      checks.push({ id: dependency, ok: true, required: true, detail: 'installed' });
    } catch {
      checks.push({ id: dependency, ok: false, required: true, detail: 'dependency unavailable' });
    }
  }
  const dataDir = path.resolve(dataDirectory);
  const probe = path.join(dataDir, `.doctor-${randomUUID()}`);
  let ownsProbe = false;
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(probe, 'wx', 0o600);
    ownsProbe = true;
    fs.closeSync(fd);
    fs.unlinkSync(probe);
    ownsProbe = false;
    checks.push({ id: 'data-directory', ok: true, required: true, detail: 'write probe passed; business files not opened' });
  } catch {
    checks.push({ id: 'data-directory', ok: false, required: true, detail: 'directory is not writable' });
  } finally {
    if (ownsProbe) { try { fs.unlinkSync(probe); } catch { /* Reported as failed above. */ } }
  }
  try {
    const { chromium } = require('playwright');
    checks.push({ id: 'test-browser', ok: fs.existsSync(chromium.executablePath()), required: false, detail: 'optional for mock browser tests; no TKC session checked' });
  } catch {
    checks.push({ id: 'test-browser', ok: false, required: false, detail: 'optional test browser unavailable' });
  }
  return {
    mode: 'P1 preview', platform: os.platform(), arch: os.arch(), node: process.version,
    previewReady: checks.filter(c => c.required).every(c => c.ok), dataDir,
    liveTkcConnection: 'unverified', liveWritesEnabled: false,
    checks,
    note: 'TKCの実画面・ログイン・取込・計上は診断していません。業務DBは開いていません。',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = diagnose();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`プレビュー起動準備: ${report.previewReady ? 'OK' : '要確認'}`);
    console.log(`${report.platform} / ${report.arch} / Node.js ${report.node}`);
    for (const check of report.checks) console.log(`${check.ok ? 'OK' : check.required ? 'NG' : '任意'} ${check.id}: ${check.detail}`);
    console.log(`保存先: ${report.dataDir}`);
    console.log(report.note);
  }
  process.exitCode = report.previewReady ? 0 : 1;
}
