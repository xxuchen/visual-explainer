import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = new URL('../plugins/visual-explainer/software-design/tests/', import.meta.url);
const tests = readdirSync(directory).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => fileURLToPath(new URL(name, directory)));
const run = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit', shell: false });
if (run.error) console.error(run.error.message);
process.exitCode = run.status ?? 1;
