// THE EASTER EGG's patcher (C-437): the player's own cart file made into DAEMONS here, in the browser -- nothing of it
// is sent anywhere. The same as the companion's (daemons-companion server/src/game/bps.ts, C-187), in plain JavaScript:
// byuu's BPS1 as DAEMONS' tools/bps.py writes it -- "BPS1", the source, target and metadata sizes as varints, the
// metadata, then actions, each a varint of (length-1)<<2 | kind: 0 SourceRead, 1 TargetRead (literal bytes follow),
// 2 SourceCopy and 3 TargetCopy (from a signed relative offset) -- and last the CRC32s of the source, the target and
// the patch. All three are checked. No DOM: the tests import it too.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const crc32Hex = (b) => crc32(b).toString(16).toUpperCase().padStart(8, "0");

export class PatchError extends Error { name = "PatchError"; }

export function applyBps(source, patch) {
  if (patch.length < 4 + 12 || String.fromCharCode(...patch.subarray(0, 4)) !== "BPS1") throw new PatchError("not a BPS patch");
  const end = patch.length - 12;
  const word = (at) => (patch[at] | (patch[at + 1] << 8) | (patch[at + 2] << 16) | (patch[at + 3] << 24)) >>> 0;
  const sourceCrc = word(end), targetCrc = word(end + 4), patchCrc = word(end + 8);
  if (crc32(patch.subarray(0, end + 8)) !== patchCrc) throw new PatchError("the patch is damaged (its own check does not match)");
  if (crc32(source) !== sourceCrc) throw new PatchError("this is not the ROM the patch was made for");
  let at = 4;
  const varint = () => {
    let n = 0, shift = 1;
    for (;;) {
      if (at >= end) throw new PatchError("the patch ends too soon");
      const b = patch[at++];
      n += (b & 0x7f) * shift;
      if (b & 0x80) break;
      shift *= 128;
      n += shift;
    }
    return n;
  };
  const sourceSize = varint(), targetSize = varint(), metaSize = varint();
  if (sourceSize !== source.length) throw new PatchError("this ROM is not the size the patch expects");
  at += metaSize;
  const target = new Uint8Array(targetSize);
  let out = 0, sourceRel = 0, targetRel = 0;
  while (at < end) {
    const d = varint(), kind = d & 3, len = (d >>> 2) + 1;
    if (out + len > targetSize) throw new PatchError("the patch writes past the end");
    if (kind === 0) { target.set(source.subarray(out, out + len), out); out += len; }
    else if (kind === 1) { target.set(patch.subarray(at, at + len), out); at += len; out += len; }
    else {
      const o = varint(), delta = (o & 1 ? -1 : 1) * Math.floor(o / 2);
      if (kind === 2) { sourceRel += delta; target.set(source.subarray(sourceRel, sourceRel + len), out); sourceRel += len; out += len; }
      else { targetRel += delta; for (let i = 0; i < len; i++) target[out++] = target[targetRel++]; }   // may overlap: byte by byte
    }
  }
  if (out !== targetSize) throw new PatchError("the patch did not fill the ROM");
  if (crc32(target) !== targetCrc) throw new PatchError("the patched ROM does not check out");
  return target;
}
