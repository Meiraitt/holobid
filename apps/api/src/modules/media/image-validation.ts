import { SourceError } from '../catalog/catalog.errors';
import { MAX_IMAGE_BYTES } from '../catalog/catalog-http.service';

export function validateImage(bytes: Buffer, mimeType: string): void {
  if (bytes.length < 12 || bytes.length > MAX_IMAGE_BYTES) {
    throw new SourceError();
  }

  const valid =
    mimeType === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mimeType === 'image/jpeg'
        ? bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255 &&
          bytes[bytes.length - 2] === 255 &&
          bytes[bytes.length - 1] === 217
        : mimeType === 'image/webp' &&
          bytes.toString('ascii', 0, 4) === 'RIFF' &&
          bytes.toString('ascii', 8, 12) === 'WEBP' &&
          bytes.length >= 20 &&
          ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16)) &&
          bytes.readUInt32LE(4) === bytes.length - 8;

  if (!valid) {
    throw new SourceError();
  }
}
