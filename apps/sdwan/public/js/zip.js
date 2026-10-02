// Minimal store-only ZIP writer (no compression, no dependencies).
const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = ~0; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };

export function zip(files) { // {name: string} -> Blob
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  const now = new Date(), dt = ((now.getFullYear() - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate()), tm = (now.getHours() << 11 | now.getMinutes() << 5 | now.getSeconds() >> 1);
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), d = enc.encode(text), c = crc32(d);
    const lh = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, tm, 2], [12, dt, 2], [14, c, 4], [18, d.length, 4], [22, d.length, 4], [26, n.length, 2], [28, 0, 2]]
      .forEach(([o, v, s]) => s === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true));
    parts.push(lh.buffer, n, d);
    const ch = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, tm, 2], [14, dt, 2], [16, c, 4], [20, d.length, 4], [24, d.length, 4], [28, n.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]]
      .forEach(([o, v, s]) => s === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true));
    cd.push(ch.buffer, n);
    off += 30 + n.length + d.length;
  }
  const cdSize = cd.reduce((a, b) => a + b.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  const cnt = Object.keys(files).length;
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, cnt, true); end.setUint16(10, cnt, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cd, end.buffer], { type: 'application/zip' });
}
