// IPS codec — the community-standard binary patch format. Pure (no node/DOM),
// so it type-checks under both tsconfigs and tests via `node`.
//
// # Format (classic IPS, verified against ../yi-patches/*.ips)
//
//   "PATCH"                       5-byte magic header
//   record*                       zero or more write records:
//     offset   3 bytes, big-endian   absolute PC offset into the target file
//     size     2 bytes, big-endian
//     if size == 0:  RLE record
//       runLen 2 bytes, big-endian   repeat count
//       value  1 byte                byte to repeat runLen times
//     else:          literal record
//       data   <size> bytes
//   "EOF"                         3-byte end marker
//   [truncate]                    optional 3-byte big-endian truncate length
//                                 (IPS extension; shrinks the output file)
//
// Offsets are absolute PC file offsets. YI reference carts are headerless 2 MB,
// so an IPS offset == cart PC offset directly (no 512-byte SMC skew).
//
// Caveat — the well-known "EOF collision": a literal record whose offset is
// exactly 0x454F46 ("EOF") is indistinguishable from the end marker. That
// offset is past 2 MB, so it can't occur for a YI cart; we don't special-case it.

const MAGIC = 'PATCH';
const EOF = 'EOF';

/** One IPS write record, preserving whether it was literal or RLE so a parse →
 *  write round-trip is byte-identical. `expandRecord` flattens either form to
 *  the actual bytes written. */
export type IpsRecord =
  | { offset: number; data: Uint8Array }
  | { offset: number; runLength: number; value: number };

/** A parsed IPS patch. `truncate` carries the optional trailing extension so a
 *  re-write reproduces the original file exactly. */
export interface IpsPatch {
  records: IpsRecord[];
  truncate?: number;
}

function isRle(r: IpsRecord): r is { offset: number; runLength: number; value: number } {
  return 'runLength' in r;
}

/** The contiguous bytes a record writes, and where. */
export function expandRecord(r: IpsRecord): { offset: number; bytes: Uint8Array } {
  if (isRle(r)) {
    const bytes = new Uint8Array(r.runLength);
    bytes.fill(r.value);
    return { offset: r.offset, bytes };
  }
  return { offset: r.offset, bytes: r.data };
}

/**
 * Parse an IPS file. Throws on a missing/short header, a truncated record, or a
 * missing EOF marker. Records are returned in file order (apply order).
 */
export function parseIps(buf: Uint8Array): IpsPatch {
  const td = new TextDecoder('latin1');
  if (buf.length < MAGIC.length + EOF.length || td.decode(buf.subarray(0, 5)) !== MAGIC) {
    throw new Error('parseIps: not an IPS file (missing PATCH header)');
  }
  const be3 = (i: number): number => (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
  const be2 = (i: number): number => (buf[i] << 8) | buf[i + 1];

  const records: IpsRecord[] = [];
  let p = MAGIC.length;
  for (;;) {
    if (p + EOF.length <= buf.length && td.decode(buf.subarray(p, p + 3)) === EOF) {
      p += EOF.length;
      break;
    }
    if (p + 5 > buf.length) throw new Error(`parseIps: truncated record header at ${p}`);
    const offset = be3(p);
    const size = be2(p + 3);
    p += 5;
    if (size === 0) {
      if (p + 3 > buf.length) throw new Error(`parseIps: truncated RLE record at ${p}`);
      const runLength = be2(p);
      const value = buf[p + 2];
      p += 3;
      records.push({ offset, runLength, value });
    } else {
      if (p + size > buf.length) throw new Error(`parseIps: truncated data record at ${p}`);
      records.push({ offset, data: buf.subarray(p, p + size) });
      p += size;
    }
  }

  // Optional truncate-extension: exactly 3 trailing bytes after EOF.
  let truncate: number | undefined;
  if (p + 3 === buf.length) {
    truncate = be3(p);
    p += 3;
  }
  if (p !== buf.length) throw new Error(`parseIps: ${buf.length - p} unexpected trailing byte(s)`);

  return truncate === undefined ? { records } : { records, truncate };
}

/** Serialize an `IpsPatch` back to bytes — the inverse of `parseIps`. A
 *  parse → write of an unmodified patch is byte-identical. */
export function writeIps(patch: IpsPatch): Uint8Array {
  const out: number[] = [];
  const pushStr = (s: string): void => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
  const push3 = (n: number): void => { out.push((n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff); };
  const push2 = (n: number): void => { out.push((n >>> 8) & 0xff, n & 0xff); };

  pushStr(MAGIC);
  for (const r of patch.records) {
    push3(r.offset);
    if (isRle(r)) {
      push2(0);
      push2(r.runLength);
      out.push(r.value & 0xff);
    } else {
      push2(r.data.length);
      for (const b of r.data) out.push(b);
    }
  }
  pushStr(EOF);
  if (patch.truncate !== undefined) push3(patch.truncate);
  return Uint8Array.from(out);
}

/**
 * Flatten an IPS patch to absolute byte writes, **coalescing runs that are
 * contiguous in the file** into single spans. This is the form the patch
 * importer annotates with asm labels and the apply step writes. Records are
 * already in file order; adjacent records whose `[offset, offset+len)` ranges
 * touch or abut merge (later bytes overwrite on exact overlap — IPS apply
 * semantics are sequential last-wins).
 */
export function flattenIps(patch: IpsPatch): Array<{ offset: number; bytes: Uint8Array }> {
  const spans: Array<{ offset: number; bytes: number[] }> = [];
  for (const r of patch.records) {
    const { offset, bytes } = expandRecord(r);
    const last = spans[spans.length - 1];
    if (last && offset === last.offset + last.bytes.length) {
      for (const b of bytes) last.bytes.push(b);
    } else if (last && offset >= last.offset && offset < last.offset + last.bytes.length) {
      // Overlap: overwrite in place, extend if it runs past the end.
      for (let i = 0; i < bytes.length; i++) last.bytes[offset - last.offset + i] = bytes[i];
    } else {
      spans.push({ offset, bytes: Array.from(bytes) });
    }
  }
  return spans.map((s) => ({ offset: s.offset, bytes: Uint8Array.from(s.bytes) }));
}
