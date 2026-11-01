// Reads width and height from a PNG header.
import { readFileSync } from 'node:fs';

export default function sizeOf(file) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
