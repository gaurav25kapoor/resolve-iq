import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const url = process.env.DATABASE_URL?.trim();
const queryFile = process.argv[2];
if (!url || !queryFile) throw new Error('DATABASE_URL and a SQL file path are required.');
const sql = await readFile(resolve(queryFile));
const child = spawn(
  'psql',
  ['--no-psqlrc', '--no-password', '--set=ON_ERROR_STOP=1', `--dbname=${url}`],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
);
const stdout = [];
const stderr = [];
child.stdout.on('data', (chunk) => stdout.push(chunk));
child.stderr.on('data', (chunk) => stderr.push(chunk));
child.once('error', () => { console.error('psql could not be started.'); process.exitCode = 1; });
child.once('close', (code) => {
  if (code !== 0) {
    const safeError = Buffer.concat(stderr).toString('utf8').replaceAll(url, '[redacted DATABASE_URL]');
    console.error(`SQL verification failed (${code}).\n${safeError}`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(Buffer.concat(stdout));
});
child.stdin.end(sql);
