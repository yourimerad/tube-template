#!/usr/bin/env node
// Prints one htpasswd line "<user>:{SHA}<base64(sha1(password))>" for nginx basic auth.
//   node lib/htpasswd.mjs <user> <password-file>
// The password is read from a file (never from argv, so it never shows in `ps`).
// {SHA} rather than bcrypt on purpose: nginx verifies the password on EVERY request (each HLS segment),
// and bcrypt pinned a 2-vCPU box under load. A long random password makes the fast hash safe enough
// (see docs/LESSONS.md).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [user, file] = process.argv.slice(2);
if (!user || !file || !/^[a-z][a-z0-9_-]{1,31}$/.test(user)) {
  console.error('usage: node lib/htpasswd.mjs <user> <password-file>');
  process.exit(2);
}
const pw = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
if (pw.length < 16) { console.error('htpasswd: password shorter than 16 chars, refusing'); process.exit(1); }
process.stdout.write(`${user}:{SHA}${createHash('sha1').update(pw).digest('base64')}\n`);
