import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEvidence, verifyEvidence, specDigest, evidencePath } from '../evidence.mjs';
import { validateDesign } from '../model.mjs';
import { exampleDesign } from './model-fixture.mjs';

function workspace(t) {
  const path = mkdtempSync(join(tmpdir(), 'sd-evidence-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function record(spec, baseDir, acceptanceId = 'AC-submit', command = [process.execPath, '-e', 'console.log("example check executed")']) {
  const receipt = `evidence/${acceptanceId}.json`;
  const result = recordEvidence(spec, baseDir, { acceptanceId, receipt, command });
  spec.acceptance.find((a) => a.id === acceptanceId).verification = { status: result.status, receipt };
  return result;
}

test('explicit executable creates a bound, inspectable receipt and log', (t) => {
  const root = workspace(t), spec = exampleDesign();
  const r = record(spec, root);
  assert.equal(r.status, 'passed');
  assert.equal(r.exitCode, 0);
  assert.match(readFileSync(join(root, r.log), 'utf8'), /example check executed/);
  assert.equal(verifyEvidence(spec, root).get('AC-submit').ok, true);
  assert.equal(validateDesign(spec, { evidence: verifyEvidence(spec, root) }).ok, true);
});

test('material source changes stale receipts; verification edits do not', (t) => {
  const root = workspace(t), spec = exampleDesign(), initial = specDigest(spec);
  record(spec, root);
  assert.equal(specDigest(spec), initial);
  spec.requirements[0].text += ' changed';
  const r = verifyEvidence(spec, root).get('AC-submit');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('stale')));
});

test('declared success fails for missing, wrong-AC, corrupted and contradictory receipts', (t) => {
  const root = workspace(t), spec = exampleDesign();
  spec.acceptance[0].verification = { status: 'passed', receipt: 'absent.json' };
  assert.equal(verifyEvidence(spec, root).get('AC-submit').ok, false);
  const r = record(spec, root);
  const path = join(root, spec.acceptance[0].verification.receipt);
  for (const change of [{ acceptanceId: 'AC-repeat' }, { exitCode: 1 }, { signal: 'SIGTERM' }, { specDigest: 'bad' }, { startedAt: 'invalid' }, { command: [] }]) {
    writeFileSync(path, JSON.stringify({ ...r, ...change }));
    assert.equal(verifyEvidence(spec, root).get('AC-submit').ok, false, JSON.stringify(change));
  }
  writeFileSync(path, JSON.stringify(r));
  writeFileSync(join(root, r.log), 'replaced log');
  assert.equal(verifyEvidence(spec, root).get('AC-submit').ok, false);
});

test('failed commands and launch errors are recorded without pretending to pass', (t) => {
  const root = workspace(t), spec = exampleDesign();
  const r = record(spec, root, 'AC-submit', [process.execPath, '-e', 'process.exit(7)']);
  assert.equal(r.status, 'failed');
  assert.equal(r.exitCode, 7);
  assert.equal(verifyEvidence(spec, root).get('AC-submit').ok, true);
  const missing = record(spec, root, 'AC-repeat', ['sd-nonexistent-executable-87423']);
  assert.equal(missing.status, 'failed');
  assert.ok(missing.error);
  assert.equal(verifyEvidence(spec, root).get('AC-repeat').ok, true);
});

test('receipt paths remain within source tree and preserve previous runs', (t) => {
  const root = workspace(t), spec = exampleDesign();
  for (const bad of ['../escape.json', '/tmp/outside.json', 'C:\\elsewhere.json', '..\\escape.json']) assert.throws(() => evidencePath(root, bad), /relative|escapes/);
  record(spec, root);
  assert.throws(() => record(spec, root), /already exists/);
  // Directory junction works without Windows symlink privilege.
  const other = workspace(t);
  symlinkSync(other, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => evidencePath(root, 'outside/run.json', { writing: true }), /symlink escapes/);
});

test('delivery gate needs all mandatory and quality receipts; shell metacharacters stay literal', (t) => {
  const root = workspace(t), spec = exampleDesign();
  const literal = 'hello; echo unwanted $(echo no) &';
  record(spec, root, 'AC-submit', [process.execPath, '-e', 'console.log(process.argv[1])', literal]);
  assert.match(readFileSync(join(root, 'evidence/AC-submit.json.log'), 'utf8'), /hello; echo unwanted/);
  assert.equal(validateDesign(spec, { phase: 'delivery', evidence: verifyEvidence(spec, root) }).ok, false);
  record(spec, root, 'AC-repeat');
  assert.equal(validateDesign(spec, { phase: 'delivery', evidence: verifyEvidence(spec, root) }).ok, true);
});
