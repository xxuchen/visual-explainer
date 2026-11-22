import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const sorted = (value) => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;

export function specDigest(spec) {
  const copy = structuredClone(spec);
  if (Array.isArray(copy?.acceptance)) for (const check of copy.acceptance) if (check && typeof check === 'object') delete check.verification;
  return hash(JSON.stringify(sorted(copy)));
}

const inside = (base, path) => {
  const rel = relative(base, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};

/** Read/write receipts only inside the source directory, including through symlinks. */
export function evidencePath(baseDir, name, { writing = false } = {}) {
  if (typeof name !== 'string' || !name.trim() || isAbsolute(name) || /^[\\/]|^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes('..')) {
    throw new Error('Evidence path must be relative to the design JSON and stay within its directory.');
  }
  const base = realpathSync(baseDir);
  const path = resolve(base, name.replace(/\\/g, '/'));
  if (!inside(base, path)) throw new Error('Evidence path escapes the design directory.');
  // Check the closest existing ancestor before creating directories through a symlink.
  let ancestor = path;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error('Evidence parent directory does not exist.');
    ancestor = parent;
  }
  if (!inside(base, realpathSync(ancestor))) throw new Error('Evidence symlink escapes the design directory.');
  if (writing) mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && !inside(base, realpathSync(path))) throw new Error('Evidence symlink escapes the design directory.');
  return path;
}

export function verifyEvidence(spec, baseDir) {
  const evidence = new Map();
  const digest = specDigest(spec);
  for (const check of Array.isArray(spec?.acceptance) ? spec.acceptance : []) {
    if (!check || !['passed', 'failed'].includes(check.verification?.status)) continue;
    const errors = [];
    let receipt;
    try {
      receipt = JSON.parse(readFileSync(evidencePath(baseDir, check.verification.receipt), 'utf8'));
      if (!receipt || receipt.schemaVersion !== 1) errors.push('Unsupported evidence receipt version.');
      if (receipt.acceptanceId !== check.id) errors.push('Receipt belongs to another acceptance criterion.');
      if (receipt.specDigest !== digest) errors.push('Receipt is stale: the design source changed. Rerun the check.');
      if (receipt.status !== check.verification.status) errors.push('Receipt status differs from the declared verification status.');
      if (!['passed', 'failed'].includes(receipt.status)) errors.push('Receipt status must be passed or failed.');
      if (!Array.isArray(receipt.command) || !receipt.command.length || receipt.command.some((v) => typeof v !== 'string') || !receipt.command[0]) errors.push('Receipt must record executable and arguments.');
      if (typeof receipt.cwd !== 'string' || !receipt.cwd) errors.push('Receipt must record the working directory.');
      const start = Date.parse(receipt.startedAt), end = Date.parse(receipt.finishedAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) errors.push('Receipt timestamps are invalid.');
      if (!(receipt.exitCode === null || Number.isInteger(receipt.exitCode))) errors.push('Receipt exitCode is invalid.');
      if (!(receipt.signal === null || typeof receipt.signal === 'string')) errors.push('Receipt signal is invalid.');
      if (receipt.status === 'passed' && (receipt.exitCode !== 0 || receipt.signal || receipt.error)) errors.push('Passed requires exit code 0 and no signal or launch error.');
      if (receipt.status === 'failed' && receipt.exitCode === 0 && !receipt.signal && !receipt.error) errors.push('Failed contradicts successful execution.');
      if (receipt.exitCode === null && !receipt.signal && !receipt.error) errors.push('Receipt has no execution outcome.');
      const log = readFileSync(evidencePath(baseDir, receipt.log));
      if (hash(log) !== receipt.logSha256) errors.push('Evidence log hash does not match.');
    } catch (error) { errors.push(error.message); }
    evidence.set(check.id, { ok: errors.length === 0, errors, status: receipt?.status, receipt });
  }
  return evidence;
}

/** Runs only argv supplied to this explicit command, never a command embedded in a design. */
export function recordEvidence(spec, baseDir, { acceptanceId, receipt: name, command, cwd = baseDir, timeoutMs = 120000 }) {
  if (!spec.acceptance?.some((check) => check.id === acceptanceId)) throw new Error(`Unknown acceptance ID: ${acceptanceId}`);
  if (!Array.isArray(command) || !command.length || command.some((v) => typeof v !== 'string') || !command[0]) throw new Error('Provide an explicit executable and arguments after --.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new Error('timeout-ms must be between 1 and 3600000.');
  const path = evidencePath(baseDir, name, { writing: true });
  const logName = `${name}.log`;
  const logPath = evidencePath(baseDir, logName, { writing: true });
  if (existsSync(path) || existsSync(logPath)) throw new Error('Evidence already exists. Choose a new receipt path to preserve the previous run.');
  const runCwd = realpathSync(resolve(cwd));
  const startedAt = new Date().toISOString();
  const run = spawnSync(command[0], command.slice(1), { cwd: runCwd, shell: false, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const error = run.error?.message;
  const status = run.status === 0 && !run.signal && !error ? 'passed' : 'failed';
  const log = `COMMAND ${JSON.stringify(command)}\nCWD ${runCwd}\n\nSTDOUT\n${run.stdout ?? ''}\nSTDERR\n${run.stderr ?? ''}${error ? `\nEXECUTION ERROR\n${error}\n` : ''}`;
  const receipt = { schemaVersion: 1, acceptanceId, specDigest: specDigest(spec), command, cwd: runCwd, startedAt,
    finishedAt: new Date().toISOString(), exitCode: run.status, signal: run.signal ?? null, status,
    log: logName.replace(/\\/g, '/'), logSha256: hash(log), ...(error ? { error } : {}) };
  writeFileSync(logPath, log, { flag: 'wx' });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}
