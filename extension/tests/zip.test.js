import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip } from '../scripts/zip.mjs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
test('portable ZIP has matching local/central records and decompressible manifest', async () => {
  const archive = await createZip(fileURLToPath(new URL('../src/', import.meta.url)), 'companion/');
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let central = archive.readUInt32LE(end + 16);
  let seen = 0;
  for (; seen < count; seen++) {
    assert.equal(archive.readUInt32LE(central), 0x02014b50);
    const offset = archive.readUInt32LE(central + 42);
    assert.equal(archive.readUInt32LE(offset), 0x04034b50);
    const nameLength = archive.readUInt16LE(central + 28);
    const name = archive.subarray(central + 46, central + 46 + nameLength).toString();
    assert.ok(name.startsWith('companion/'));
    const compressedSize = archive.readUInt32LE(central + 20);
    const originalSize = archive.readUInt32LE(central + 24);
    const body = offset + 30 + archive.readUInt16LE(offset + 26);
    assert.equal(inflateRawSync(archive.subarray(body, body + compressedSize)).length, originalSize);
    assert.equal(archive.readUInt32LE(offset + 14), archive.readUInt32LE(central + 16));
    central += 46 + nameLength;
  }
  assert.equal(central, end);
  assert.ok(seen >= 3);
});
