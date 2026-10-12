import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { open, rename, unlink, chmod } from 'node:fs/promises';
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function seal(key, value, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return { format: 2, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function unseal(key, envelope, context) {
  if (envelope?.format !== 2) throw new Error('ENCRYPTED_FORMAT_INVALID');
  const iv = Buffer.from(String(envelope.iv || ''), 'base64');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('ENCRYPTED_FORMAT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(String(envelope.ciphertext || ''), 'base64')), decipher.final()]).toString('utf8'));
}

// Flush bytes before atomic rename; Linux also syncs directory metadata.
export async function durableWrite(path, contents) {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents); await handle.sync();
    await handle.close(); handle = null;
    await rename(temporary, path); await chmod(path, 0o600);
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

export function durableWriteSync(path, contents) {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, contents); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path); chmodSync(path, 0o600);
    if (process.platform !== 'win32') {
      const dir = openSync(dirname(path), 'r');
      try { fsyncSync(dir); } finally { closeSync(dir); }
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch { /* already renamed */ }
  }
}
