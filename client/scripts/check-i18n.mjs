// Verifies that every translation key used in the code exists in both fa.ts and en.ts,
// including the keys built from templates (permissions, durations, statuses...).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !p.includes('/i18n/')) files.push(p);
  }
})(root);

const keysOf = (file) => new Set([...readFileSync(join(root, 'i18n', file), 'utf8').matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
const fa = keysOf('fa.ts');
const en = keysOf('en.ts');

const used = new Set();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
}
const perms = [...readFileSync(join(root, '../../shared/permissions.ts'), 'utf8').matchAll(/^\s{2}([A-Z_]+): 1 << \d+,/gm)].map((m) => m[1]);
const dynamic = [
  ...perms.flatMap((p) => [`perm.${p}`, `perm.${p}.hint`]),
  ...['general', 'membership', 'text', 'voice', 'advanced'].map((g) => `perm.group.${g}`),
  ...['allow', 'deny', 'inherit'].map((s) => `perm.state.${s}`),
  ...['online', 'idle', 'dnd', 'invisible', 'offline'].map((s) => `status.${s}`),
  ...['online', 'idle', 'dnd', 'invisible'].map((s) => `status.${s}Hint`),
  ...[0, 1, 3, 4, 5, 6, 7, 8, 9].map((g) => `emoji.group.${g}`),
  ...[5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 28800, 43200, 86400, 259200, 604800].map((d) => `duration.${d}`),
  ...['online', 'all', 'pending', 'blocked'].flatMap((x) => [`friends.empty.${x}`, `friends.count.${x}`]),
  ...['all', 'mentions', 'none'].flatMap((l) => [`notify.level.${l}`, `notify.level.${l}Hint`]),
  ...['dark', 'light', 'system'].map((x) => `us.theme.${x}`),
  ...['new', 'connecting', 'disconnected', 'failed', 'closed', 'connected'].map((x) => `voice.state.${x}`),
  ...['roll', 'poll', 'shrug', 'tableflip', 'unflip', 'me', 'spoiler'].map((x) => `command.${x}`),
  ...['everyone', 'here'].map((x) => `composer.${x}`),
  ...['username', 'email', 'password', 'displayName', 'locale'].map((x) => `auth.invalid.${x}`),
  ...[1, 2, 3, 4, 5].map((n) => `system.join${n}`),
];
let problems = 0;
for (const key of [...used, ...dynamic]) {
  for (const [name, dict] of [['fa', fa], ['en', en]]) {
    if (!dict.has(key)) {
      console.log(`missing in ${name}: ${key}`);
      problems++;
    }
  }
}
for (const key of fa) if (!en.has(key)) (console.log(`only in fa: ${key}`), problems++);
for (const key of en) if (!fa.has(key) && !key.endsWith('_one')) (console.log(`only in en: ${key}`), problems++);
console.log(`${used.size} static + ${dynamic.length} dynamic keys checked, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
