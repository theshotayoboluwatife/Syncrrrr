const CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

// Krumhansl-Kessler key profiles — gold standard for chroma-based key detection
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / (Math.sqrt(da * db) || 1);
}

function chromaToCamelot(chroma: number[]): string {
  let bestScore = -Infinity;
  let bestKey = 0;
  let bestIsMajor = true;
  for (let root = 0; root < 12; root++) {
    const rotated = Array.from({ length: 12 }, (_, i) => chroma[(i + root) % 12]);
    const majorCorr = pearsonCorrelation(rotated, KK_MAJOR);
    const minorCorr = pearsonCorrelation(rotated, KK_MINOR);
    if (majorCorr > bestScore) { bestScore = majorCorr; bestKey = root; bestIsMajor = true; }
    if (minorCorr > bestScore) { bestScore = minorCorr; bestKey = root; bestIsMajor = false; }
  }
  return bestIsMajor ? CAMELOT_MAJOR[bestKey] : CAMELOT_MINOR[bestKey];
}

async function estimateBpm(channelData: Float32Array, sampleRate: number): Promise<number> {
  // Onset detection via energy flux (~11.6ms hop = ~86 fps)
  const hopSize = Math.floor(sampleRate * 0.0116);
  const maxFrames = Math.min(
    Math.floor(channelData.length / hopSize),
    Math.floor(30 * sampleRate / hopSize) // analyze up to 30s
  );

  const onset = new Float32Array(maxFrames);
  let prevEnergy = 0;
  for (let i = 0; i < maxFrames; i++) {
    let energy = 0;
    const base = i * hopSize;
    for (let j = 0; j < hopSize; j++) energy += (channelData[base + j] || 0) ** 2;
    energy /= hopSize;
    onset[i] = Math.max(0, energy - prevEnergy);
    prevEnergy = energy;
  }

  // Autocorrelation — correlate onset envelope against itself at beat-period lags
  const fps = sampleRate / hopSize;
  const minLag = Math.round(fps * 60 / 200); // 200 BPM
  const maxLag = Math.round(fps * 60 / 60);  // 60 BPM

  let bestCorr = -1;
  let bestLag = Math.round(fps * 60 / 120);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const n = maxFrames - lag;
    for (let i = 0; i < n; i++) corr += onset[i] * onset[i + lag];
    corr /= n;
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }

  let bpm = Math.round(60 / (bestLag / fps));
  while (bpm < 60) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return bpm;
}

async function extractAveragedChroma(audioBuffer: AudioBuffer): Promise<number[]> {
  const Meyda = (await import("meyda")).default;
  const bufferSize = 4096;
  const channelData = audioBuffer.getChannelData(0);
  const totalChroma = new Array(12).fill(0);
  let count = 0;

  // Sample 20 evenly-spaced windows across the middle 80% of the track
  const start = Math.floor(channelData.length * 0.1);
  const end = Math.floor(channelData.length * 0.9);
  const step = Math.floor((end - start) / 20);

  for (let pos = start; pos + bufferSize < end; pos += step) {
    try {
      const features = Meyda.extract(["chroma"], channelData.slice(pos, pos + bufferSize));
      if (features?.chroma) {
        for (let i = 0; i < 12; i++) totalChroma[i] += (features.chroma as number[])[i];
        count++;
      }
    } catch { /* skip frames that fail */ }
  }

  return count > 0 ? totalChroma.map(v => v / count) : totalChroma;
}

/**
 * Extract the embedded album cover from an audio file.
 *
 * Tries (in order): inline ID3v2 APIC (MP3/AIFF/WAV) and MP4 'covr' atom (M4A/MP4/AAC).
 * Returns null if no art is embedded or parsing fails — never throws.
 *
 * Implemented manually rather than via `music-metadata` because that package
 * has had unreliable browser bundling under Vite; this small parser handles
 * the >99% case (ID3v2 + MP4) without any dependencies.
 */
export async function extractCoverArt(file: File): Promise<Blob | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    // ID3v2 header: "ID3" + version + flags + 4-byte synchsafe size
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const tagSize =
        ((head[6] & 0x7f) << 21) |
        ((head[7] & 0x7f) << 14) |
        ((head[8] & 0x7f) << 7) |
        (head[9] & 0x7f);
      const buf = new Uint8Array(await file.slice(0, 10 + tagSize).arrayBuffer());
      const cover = parseId3v2Apic(buf);
      if (cover) {
        console.debug("[cover] extracted from ID3v2 APIC", { size: cover.size, type: cover.type });
        return cover;
      }
      console.debug("[cover] ID3v2 tag found but no APIC frame", { tagSize, version: head[3], flags: head[5] });
    }
    // Try MP4 'covr' atom for m4a/mp4 audio. Read up to ~4MB which is enough
    // to cover the moov atom in nearly all consumer audio files.
    const limit = Math.min(file.size, 4 * 1024 * 1024);
    const mp4Buf = new Uint8Array(await file.slice(0, limit).arrayBuffer());
    const covr = parseMp4Covr(mp4Buf);
    if (covr) {
      console.debug("[cover] extracted from MP4 covr", { size: covr.size });
      return covr;
    }
    console.debug("[cover] no cover art found", { fileType: file.type, size: file.size });
    return null;
  } catch (e) {
    console.warn("[cover] extraction failed:", e);
    return null;
  }
}

/**
 * Reverse ID3v2 unsynchronisation: bytes 0xFF 0x00 that were inserted to keep
 * the tag from looking like an MPEG sync header. We strip the 0x00.
 */
function deunsync(buf: Uint8Array): Uint8Array {
  const out = new Uint8Array(buf.length);
  let w = 0;
  for (let r = 0; r < buf.length; r++) {
    out[w++] = buf[r];
    if (buf[r] === 0xff && r + 1 < buf.length && buf[r + 1] === 0x00) r++;
  }
  return out.subarray(0, w);
}

function parseId3v2Apic(rawBuf: Uint8Array): Blob | null {
  if (rawBuf.length < 10) return null;
  const versionMajor = rawBuf[3];
  const flags = rawBuf[5];
  // Whole-tag unsynchronisation (ID3v2.2/2.3): undo across the body.
  const body = (flags & 0x80) && versionMajor < 4
    ? new Uint8Array([...rawBuf.subarray(0, 10), ...deunsync(rawBuf.subarray(10))])
    : rawBuf;
  const buf = body;
  // ID3v2.2 uses 3-char frame IDs and 3-byte sizes — different layout entirely.
  if (versionMajor === 2) {
    let p = 10;
    while (p + 6 <= buf.length) {
      const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2]);
      if (id === "\0\0\0") break;
      const size = (buf[p + 3] << 16) | (buf[p + 4] << 8) | buf[p + 5];
      const frameStart = p + 6;
      if (size <= 0 || frameStart + size > buf.length) break;
      if (id === "PIC") {
        const cover = readApicFrame(buf.subarray(frameStart, frameStart + size), true);
        if (cover) return cover;
      }
      p = frameStart + size;
    }
    return null;
  }
  let pos = 10;
  // Skip extended header if present (ID3v2.3+)
  if (flags & 0x40 && versionMajor >= 3) {
    const ext =
      versionMajor === 4
        ? ((buf[pos] & 0x7f) << 21) | ((buf[pos + 1] & 0x7f) << 14) | ((buf[pos + 2] & 0x7f) << 7) | (buf[pos + 3] & 0x7f)
        : (buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    pos += 4 + ext;
  }
  while (pos + 10 <= buf.length) {
    const id = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
    if (id === "\0\0\0\0") break;
    let size: number;
    if (versionMajor === 4) {
      size =
        ((buf[pos + 4] & 0x7f) << 21) |
        ((buf[pos + 5] & 0x7f) << 14) |
        ((buf[pos + 6] & 0x7f) << 7) |
        (buf[pos + 7] & 0x7f);
    } else {
      size = (buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7];
    }
    const frameFlags2 = buf[pos + 9];
    let frameStart = pos + 10;
    let frameSize = size;
    // ID3v2.4 frame-level flags
    if (versionMajor === 4) {
      // Data Length Indicator: 4 extra bytes at frame start
      if (frameFlags2 & 0x01) {
        frameStart += 4;
        frameSize -= 4;
      }
    }
    if (frameSize <= 0 || frameStart + frameSize > buf.length) break;
    if (id === "APIC") {
      let frame = buf.subarray(frameStart, frameStart + frameSize);
      // Per-frame unsynchronisation (ID3v2.4)
      if (versionMajor === 4 && (frameFlags2 & 0x02)) frame = deunsync(frame);
      const cover = readApicFrame(frame, false);
      if (cover) return cover;
    }
    pos = frameStart + frameSize;
  }
  return null;
}

function readApicFrame(frame: Uint8Array, isV22: boolean): Blob | null {
  let i = 0;
  if (i >= frame.length) return null;
  const encoding = frame[i++];
  let mime = "image/jpeg";
  if (isV22) {
    // 3-char image format: "JPG" or "PNG"
    if (i + 3 > frame.length) return null;
    const fmt = String.fromCharCode(frame[i], frame[i + 1], frame[i + 2]).toUpperCase();
    mime = fmt === "PNG" ? "image/png" : "image/jpeg";
    i += 3;
  } else {
    const mimeEnd = frame.indexOf(0, i);
    if (mimeEnd < 0) return null;
    mime = new TextDecoder().decode(frame.subarray(i, mimeEnd)) || "image/jpeg";
    if (!mime.includes("/")) mime = `image/${mime.toLowerCase()}`;
    i = mimeEnd + 1;
  }
  if (i >= frame.length) return null;
  i += 1; // picture type
  // Skip description (terminator depends on encoding)
  if (encoding === 1 || encoding === 2) {
    while (i + 1 < frame.length && !(frame[i] === 0 && frame[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < frame.length && frame[i] !== 0) i++;
    i += 1;
  }
  if (i >= frame.length) return null;
  const data = frame.subarray(i);
  if (data.length === 0) return null;
  return new Blob([data], { type: mime });
}

function parseMp4Covr(buf: Uint8Array): Blob | null {
  // Walk top-level boxes looking for moov > udta > meta > ilst > covr
  const findBox = (start: number, end: number, name: string): [number, number] | null => {
    let p = start;
    while (p + 8 <= end) {
      const size = (buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
      const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
      if (size < 8 || p + size > end) return null;
      if (type === name) return [p + 8, p + size];
      p += size;
    }
    return null;
  };
  const moov = findBox(0, buf.length, "moov");
  if (!moov) return null;
  const udta = findBox(moov[0], moov[1], "udta");
  if (!udta) return null;
  const meta = findBox(udta[0], udta[1], "meta");
  if (!meta) return null;
  // 'meta' has a 4-byte version/flags prefix before child boxes
  const ilst = findBox(meta[0] + 4, meta[1], "ilst");
  if (!ilst) return null;
  const covr = findBox(ilst[0], ilst[1], "covr");
  if (!covr) return null;
  // covr contains a 'data' box: size(4) + 'data' + flags(4) + reserved(4) + payload
  const dataBox = findBox(covr[0], covr[1], "data");
  if (!dataBox) return null;
  const payload = buf.subarray(dataBox[0] + 8, dataBox[1]);
  if (payload.length === 0) return null;
  // Sniff PNG vs JPEG
  const isPng = payload[0] === 0x89 && payload[1] === 0x50 && payload[2] === 0x4e && payload[3] === 0x47;
  return new Blob([payload], { type: isPng ? "image/png" : "image/jpeg" });
}

export async function analyzeAudioFile(
  file: File
): Promise<{ bpm: number | null; camelotKey: string | null; durationSeconds: number | null }> {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtx();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const durationSeconds = audioBuffer.duration;
    const channelData = audioBuffer.getChannelData(0);

    const [bpm, chroma] = await Promise.all([
      estimateBpm(channelData, audioBuffer.sampleRate),
      extractAveragedChroma(audioBuffer),
    ]);

    const camelotKey = chromaToCamelot(chroma);

    await audioCtx.close();
    return { bpm, camelotKey, durationSeconds };
  } catch (e) {
    console.error("Audio analysis failed:", e);
    return { bpm: null, camelotKey: null, durationSeconds: null };
  }
}
