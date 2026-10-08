import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { diagnose } from '../src/doctor.js';

test('doctor reports local readiness without opening business data or claiming TKC access', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkc-doctor-'));
  try {
    const businessFile = path.join(root, 'ledger.sqlite');
    const sentinel = Buffer.from('not a SQLite database; must remain untouched');
    fs.writeFileSync(businessFile, sentinel);
    const result = diagnose(root);
    assert.equal(result.previewReady, true);
    assert.equal(result.liveTkcConnection, 'unverified');
    assert.equal(result.liveWritesEnabled, false);
    assert.deepEqual(fs.readFileSync(businessFile), sentinel);
    assert.deepEqual(fs.readdirSync(root), ['ledger.sqlite']);
    assert.equal(JSON.stringify(result).includes(sentinel.toString()), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('doctor JSON CLI fails if the data directory cannot be created', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkc-doctor-'));
  try {
    const file = path.join(root, 'existing-file');
    fs.writeFileSync(file, 'preserve');
    const result = spawnSync(process.execPath, ['dist/src/doctor.js', '--json'], {
      encoding: 'utf8', env: { ...process.env, DATA_DIR: file },
    });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.previewReady, false);
    assert.equal(report.liveWritesEnabled, false);
    assert.equal(report.checks.find((c: { id: string }) => c.id === 'data-directory').ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'preserve');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
