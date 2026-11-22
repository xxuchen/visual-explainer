import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleDesign } from './model-fixture.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
function workspace(t) {
  const path = mkdtempSync(join(tmpdir(), 'sd-cli-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', shell: false });
const json = (run) => JSON.parse(run.stdout);
function source(root) { const path = join(root, 'design.json'); writeFileSync(path, JSON.stringify(exampleDesign())); return path; }

test('CLI renders, rerenders, preserves locale, and binds report to final offline HTML', (t) => {
  const root = workspace(t), input = source(root), out = join(root, 'design.html');
  for (let i = 0; i < 2; i++) {
    const result = run(['render', input, '--out', out], root);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const report = json(result), html = readFileSync(out, 'utf8');
    assert.equal(report.static.status, 'passed');
    assert.equal(report.browser.status, 'not-run');
    assert.equal(report.business['AC-submit'], 'not-run');
    assert.equal(report.htmlSha256, createHash('sha256').update(html).digest('hex'));
    assert.match(html, /lang="zh-CN"/);
    assert.match(html, /Content-Security-Policy/);
    const inspected = run(['inspect', out, '--spec', input], root);
    assert.equal(inspected.status, 0, inspected.stderr + inspected.stdout);
    assert.equal(json(inspected).static.ok, true);
  }
});

test('CLI rejects broken coverage before writing HTML and preserves unrelated output', (t) => {
  const root = workspace(t), input = source(root), out = join(root, 'design.html');
  const spec = JSON.parse(readFileSync(input));
  spec.requirements[0].ruleIds.push('BR-missing');
  writeFileSync(input, JSON.stringify(spec));
  assert.equal(run(['render', input, '--out', out], root).status, 1);
  assert.equal(existsSync(out), false);
  writeFileSync(input, JSON.stringify(exampleDesign()));
  writeFileSync(out, '<p>user-authored</p>');
  assert.equal(run(['render', input, '--out', out], root).status, 1);
  assert.equal(readFileSync(out, 'utf8'), '<p>user-authored</p>');
});

test('CLI init creates a usable full example and never overwrites a source', (t) => {
  const root = workspace(t), input = join(root, 'example.json');
  assert.equal(run(['init', input], root).status, 0);
  const initial = readFileSync(input, 'utf8');
  assert.equal(JSON.parse(initial).diagrams.length, 5);
  assert.equal(run(['validate', input], root).status, 0);
  assert.equal(run(['init', input], root).status, 1);
  assert.equal(readFileSync(input, 'utf8'), initial);
});

test('optional and required browser checks expose unavailable execution without pass', (t) => {
  const root = workspace(t), input = source(root), out = join(root, 'design.html');
  const missing = join(root, 'browser-does-not-exist');
  const optional = run(['render', input, '--out', out, '--browser', '--browser-executable', missing], root);
  assert.equal(optional.status, 0, optional.stderr + optional.stdout);
  assert.equal(json(optional).browser.status, 'skipped');
  const required = run(['render', input, '--out', out, '--require-browser', '--browser-executable', missing], root);
  assert.equal(required.status, 1, required.stderr + required.stdout);
  assert.notEqual(json(required).browser.status, 'passed');
  assert.equal(existsSync(`${out}.checks.json`), true);
});

test('record is explicit, retains source, and gates delivery until all criteria pass', (t) => {
  const root = workspace(t), input = source(root), original = readFileSync(input, 'utf8');
  assert.equal(run(['validate', input, '--phase', 'delivery'], root).status, 1);
  const spec = JSON.parse(original);
  for (const ac of spec.acceptance) {
    const receipt = `evidence/${ac.id}.json`;
    // This is a harness check of recording; it is not a business acceptance claim.
    const r = run(['record', input, '--acceptance', ac.id, '--receipt', receipt, '--', process.execPath, '-e', 'console.log("harness recording check")'], root);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(readFileSync(input, 'utf8'), original);
    ac.verification = { status: 'passed', receipt };
  }
  writeFileSync(input, JSON.stringify(spec));
  assert.equal(run(['validate', input, '--phase', 'delivery'], root).status, 0);
  spec.summary += ' requirement revision';
  writeFileSync(input, JSON.stringify(spec));
  const stale = run(['validate', input, '--phase', 'delivery'], root);
  assert.equal(stale.status, 1);
  assert.ok(json(stale).errors.some((e) => e.code === 'verification-evidence'));
});

test('bad flags and malformed source fail without executing or writing output', (t) => {
  const root = workspace(t), input = source(root);
  for (const args of [['validate', input, '--phase', 'typo'], ['render', input], ['inspect', input, '--unknown'], ['record', input, '--acceptance', 'AC-submit', '--receipt', 'run.json']]) assert.equal(run(args, root).status, 1);
  writeFileSync(input, 'null');
  assert.equal(run(['validate', input], root).status, 1);
  assert.deepEqual(readdirSync(root), ['design.json']);
});


test('CLI executes through a linked skill directory, including paths with spaces', (t) => {
  const root = workspace(t), linked = join(root, 'linked skill');
  symlinkSync(fileURLToPath(new URL('../../', import.meta.url)), linked, process.platform === 'win32' ? 'junction' : 'dir');
  const input = join(root, 'linked design.json');
  const result = spawnSync(process.execPath, [join(linked, 'software-design/cli.mjs'), 'init', input], { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(existsSync(input), true);
  assert.equal(json(result).status, 'created');
});

test('source URLs remain clickable without loading resources or accepting executable links', (t) => {
  const root = workspace(t), input = source(root), out = join(root, 'sources.html');
  const spec = JSON.parse(readFileSync(input));
  spec.rules[0].source = '需求来源 https://example.test/req?a=1&b=2；javascript:alert(1)';
  writeFileSync(input, JSON.stringify(spec));
  const result = run(['render', input, '--out', out], root);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /href="https:\/\/example\.test\/req\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.equal(json(result).static.ok, true);
});
