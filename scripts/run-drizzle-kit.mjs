import os from 'node:os';
import { createRequire } from 'node:module';

// This Windows environment can fail Node's native userInfo() lookup with ENOMEM.
// Drizzle Kit only uses the username to name its temporary IPC directory.
os.userInfo = () => ({
  username: process.env.USERNAME || 'resolveiq',
  uid: -1,
  gid: -1,
  shell: null,
  homedir: process.env.USERPROFILE || process.cwd(),
});

process.argv = ['node', 'drizzle-kit', ...process.argv.slice(2)];
createRequire(import.meta.url)('../node_modules/drizzle-kit/bin.cjs');
