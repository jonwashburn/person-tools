// The length in seconds of an audio or video file, read from its own header, for what is uploaded or copied in: the
// minutes a call takes and the listen/watch record both need it. WAV, MP4/M4A/MOV, MP3 (Xing/Info/VBRI or constant
// bit rate), FLAC. Anything else returns null, and the record then takes the length from the person's player.
export function mediaLength(buf, contentType = '') {
  try {
    const b = new Uint8Array(buf); if (b.length < 12) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const str = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
    const ok = (s) => (s > 0 && s < 24 * 3600 ? Math.round(s * 10) / 10 : null);
    if (str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE') return ok(wav(b, dv, str));
    if (str(0, 4) === 'fLaC') return ok(flac(b, dv));
    if (str(4, 4) === 'ftyp' || str(4, 4) === 'moov') return ok(mp4(b, dv, str));
    // MP3 only when it says so (its type, an ID3 tag, or a frame at the very start): a frame scan finds false syncs elsewhere
    const ct = String(contentType || '').toLowerCase();
    if (str(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || /^audio\/(mpeg|mp3|mpeg3|x-mpeg)$/.test(ct)) return ok(mp3(b, dv, str));
    return null;
  } catch { return null; }
}

function wav(b, dv, str) {
  let o = 12, byteRate = 0;
  while (o + 8 <= b.length) {
    const id = str(o, 4), size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') byteRate = dv.getUint32(o + 16, true);
    if (id === 'data') return byteRate ? Math.min(size, b.length - o - 8) / byteRate : null;
    o += 8 + size + (size & 1);
  }
  return null;
}

function flac(b, dv) {   // STREAMINFO is the first metadata block: sample rate 20 bits, total samples 36 bits
  const p = 8;
  const rate = (b[p + 10] << 12) | (b[p + 11] << 4) | (b[p + 12] >> 4);
  const total = (b[p + 13] & 0x0f) * 2 ** 32 + dv.getUint32(p + 14);
  return rate && total ? total / rate : null;
}

function mp4(b, dv, str) {   // the movie header: mvhd's timescale and duration
  for (let i = 4; i + 32 < b.length; i++) {
    if (b[i] !== 0x6d || str(i, 4) !== 'mvhd') continue;   // 'm'
    const v = b[i + 4];
    if (v === 1) { const ts = dv.getUint32(i + 24); const dur = dv.getUint32(i + 28) * 2 ** 32 + dv.getUint32(i + 32); return ts ? dur / ts : null; }
    const ts = dv.getUint32(i + 16), dur = dv.getUint32(i + 20); return ts ? dur / ts : null;
  }
  return null;
}

const BR = { // kbit/s by [version 1 | 2/2.5][layer 3, 2, 1]
  1: { 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448] },
  2: { 3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256] },
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };   // by version bits (3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5)

function mp3(b, dv, str) {
  let o = 0;
  if (str(0, 3) === 'ID3') o = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  for (let n = 0; o + 4 < b.length && n < 65536; o++, n++) {
    if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) continue;
    const vbits = (b[o + 1] >> 3) & 3, lbits = (b[o + 1] >> 1) & 3, bri = b[o + 2] >> 4, sri = (b[o + 2] >> 2) & 3;
    if (vbits === 1 || lbits === 0 || bri === 0 || bri === 15 || sri === 3) continue;
    const layer = 4 - lbits, v1 = vbits === 3, rate = SR[vbits][sri], kbps = BR[v1 ? 1 : 2][layer][bri];
    const spf = layer === 1 ? 384 : layer === 2 ? 1152 : (v1 ? 1152 : 576);
    const mono = (b[o + 3] >> 6) === 3;
    const side = v1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    for (const at of [o + 4 + side, o + 36]) {   // Xing/Info after the side information; VBRI at a fixed 32 bytes
      const tag = str(at, 4);
      if ((tag === 'Xing' || tag === 'Info') && (dv.getUint32(at + 4) & 1)) return dv.getUint32(at + 8) * spf / rate;
      if (tag === 'VBRI') return dv.getUint32(at + 14) * spf / rate;
    }
    return (b.length - o) * 8 / (kbps * 1000);   // constant bit rate
  }
  return null;
}
