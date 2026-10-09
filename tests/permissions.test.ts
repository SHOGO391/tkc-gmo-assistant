import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/demo.js';

const posix = process.platform !== 'win32';
const mode = (p: string) => fs.statSync(p).mode & 0o777;
function assertPrivateTree(root: string) {
  if (!posix) return;
  assert.equal(mode(root), 0o700, root);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) assertPrivateTree(p);
    else assert.equal(mode(p), 0o600, p);
  }
}

test('permissive umask cannot expose database, backup, restore or handoff', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkc-permissions-'));
  const previous = process.umask(0o022);
  t.after(() => { process.umask(previous); fs.rmSync(root, { recursive: true, force: true }); });
  const data = path.join(root, 'data'), store = new Store(data);
  try {
    const job = seedDemo(store);
    assertPrivateTree(data); // Includes live WAL and SHM files.
    const backup = await store.backup(path.join(root, 'backup'));
    assertPrivateTree(backup);
    const run = (...args: string[]) => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
        cwd: process.cwd(), env: { ...process.env, DATA_DIR: data }, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      return result;
    };
    const output = path.join(root, 'handoff.csv');
    run('export_handoff', job.id, output);
    if (posix) assert.equal(mode(output), 0o600);
    const restored = path.join(root, 'restored');
    run('restore', backup, restored);
    assertPrivateTree(restored);
    const reopened = new Store(restored);
    try { assert.equal(reopened.get('jobs', job.id).paused, true); }
    finally { reopened.close(); }
  } finally { store.close(); }
});

test('opening an older data directory repairs permissive modes without losing records', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkc-old-permissions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = new Store(root), job = seedDemo(first);
  first.close();
  for (const p of [root, path.join(root, 'originals')]) fs.chmodSync(p, 0o755);
  for (const p of [path.join(root, 'app.sqlite'), ...fs.readdirSync(path.join(root, 'originals')).map(f => path.join(root, 'originals', f))]) fs.chmodSync(p, 0o644);
  const reopened = new Store(root);
  try { assertPrivateTree(root); assert.equal(reopened.transactions(job.id).length, 10); }
  finally { reopened.close(); }
});

test('a symlinked database is rejected without changing the target', { skip: !posix }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkc-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'unrelated.txt'), data = path.join(root, 'data');
  fs.writeFileSync(target, 'unchanged'); fs.chmodSync(target, 0o644);
  fs.mkdirSync(data); fs.symlinkSync(target, path.join(data, 'app.sqlite'));
  assert.throws(() => new Store(data), /regular/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged'); assert.equal(mode(target), 0o644);
});
