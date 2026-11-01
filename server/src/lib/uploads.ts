import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { badRequest, HttpError } from './errors';

export interface StoredFile {
  url: string;
  filename: string;
  size: number;
  contentType: string;
}

const IMAGE_TYPES: Record<string, { ext: string; mime: string }> = {
  png: { ext: '.png', mime: 'image/png' },
  jpeg: { ext: '.jpg', mime: 'image/jpeg' },
  gif: { ext: '.gif', mime: 'image/gif' },
  webp: { ext: '.webp', mime: 'image/webp' },
};

/** Identify PNG, JPEG, GIF and WebP by their magic bytes. */
export function detectImage(buf: Buffer): keyof typeof IMAGE_TYPES | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 6 && (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a'))
    return 'gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
    return 'webp';
  return null;
}

/** Keep letters (any script), digits, dot, dash and underscore. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  let cleaned = base
    .normalize('NFC')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/^\.+/, '');
  if (!cleaned) cleaned = 'file';
  if (cleaned.length > 100) {
    const ext = extname(cleaned).slice(0, 12);
    cleaned = cleaned.slice(0, 100 - ext.length) + ext;
  }
  return cleaned;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
};

export class UploadService {
  constructor(
    private dir: string,
    private maxBytes: number,
  ) {}

  private async newFolder(): Promise<{ folder: string; key: string }> {
    const key = randomBytes(12).toString('hex');
    const folder = join(this.dir, key);
    await mkdir(folder, { recursive: true });
    return { folder, key };
  }

  /** Stream an attachment to disk. Throws 413 when the size limit is exceeded. */
  async saveStream(stream: Readable & { truncated?: boolean }, originalName: string): Promise<StoredFile> {
    const filename = safeFilename(originalName);
    const { folder, key } = await this.newFolder();
    const path = join(folder, filename);
    try {
      await pipeline(stream, createWriteStream(path));
    } catch (err) {
      await rm(folder, { recursive: true, force: true });
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge(this.maxBytes);
      throw err;
    }
    if (stream.truncated) {
      await rm(folder, { recursive: true, force: true });
      throw tooLarge(this.maxBytes);
    }
    const { size } = await stat(path);
    const contentType = MIME_BY_EXT[extname(filename).toLowerCase()] ?? 'application/octet-stream';
    return { url: `/uploads/${key}/${encodeURIComponent(filename)}`, filename, size, contentType };
  }

  /** Save an image (avatar, icon, emoji) after checking its real format. */
  async saveImage(buf: Buffer, baseName: string, maxBytes: number): Promise<StoredFile & { animated: boolean }> {
    if (buf.length > maxBytes) throw tooLarge(maxBytes);
    const kind = detectImage(buf);
    if (!kind) throw badRequest('invalid_image', 'Only PNG, JPEG, GIF and WebP images are allowed');
    const { ext, mime } = IMAGE_TYPES[kind];
    const filename = `${baseName}${ext}`;
    const { folder, key } = await this.newFolder();
    await writeFile(join(folder, filename), buf);
    return { url: `/uploads/${key}/${filename}`, filename, size: buf.length, contentType: mime, animated: kind === 'gif' };
  }

  /** Delete a stored file by its public URL. Ignores URLs outside the upload folder. */
  async remove(url: string | null | undefined) {
    if (!url?.startsWith('/uploads/')) return;
    const key = url.split('/')[2];
    if (!key || !/^[0-9a-f]{24}$/.test(key)) return;
    const folder = resolve(this.dir, key);
    if (!folder.startsWith(resolve(this.dir) + sep)) return;
    await rm(folder, { recursive: true, force: true });
  }

  get limit() {
    return this.maxBytes;
  }
}

function tooLarge(max: number) {
  return new HttpError(413, 'file_too_large', `Files can be at most ${Math.floor(max / 1024 / 1024) || 1} MB`, {
    maxBytes: max,
  });
}
