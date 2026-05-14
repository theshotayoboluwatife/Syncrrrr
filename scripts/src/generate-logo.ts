import opentype from "opentype.js";
import sharp from "sharp";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FONT_PATH = join(import.meta.dirname ?? __dirname, "..", "Syne-ExtraBold.ttf");
const OUT_DIR = join(import.meta.dirname ?? __dirname, "..", "..", "attached_assets", "logo");

mkdirSync(OUT_DIR, { recursive: true });

const fontBuf = readFileSync(FONT_PATH);
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

const TEXT = "Syncr";
const DOT = ".";
const FONT_SIZE = 1000;

// Generate path for the wordmark
const wordmarkPath = font.getPath(TEXT, 0, 0, FONT_SIZE, {
  letterSpacing: -0.055,
});

// Get advance width of the wordmark (where the period should start)
const wordmarkAdvance = font.getAdvanceWidth(TEXT, FONT_SIZE, {
  letterSpacing: -0.055,
});

// Generate path for the period — placed right after wordmark
const dotPath = font.getPath(DOT, wordmarkAdvance, 0, FONT_SIZE, {});

// Compute bounding box of full composition (wordmark + dot)
const wbb = wordmarkPath.getBoundingBox();
const dbb = dotPath.getBoundingBox();
const x1 = Math.min(wbb.x1, dbb.x1);
const y1 = Math.min(wbb.y1, dbb.y1);
const x2 = Math.max(wbb.x2, dbb.x2);
const y2 = Math.max(wbb.y2, dbb.y2);

const PAD = 80; // padding around glyphs
const vbX = x1 - PAD;
const vbY = y1 - PAD;
const vbW = x2 - x1 + PAD * 2;
const vbH = y2 - y1 + PAD * 2;

const wordmarkD = wordmarkPath.toPathData(2);
const dotD = dotPath.toPathData(2);

function buildSvg(opts: {
  fg: string;
  accent: string;
  bg?: string | null;
}): string {
  const bgRect =
    opts.bg && opts.bg !== "transparent"
      ? `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${opts.bg}"/>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">
  ${bgRect}
  <path d="${wordmarkD}" fill="${opts.fg}"/>
  <path d="${dotD}" fill="${opts.accent}"/>
</svg>`;
}

// Variants
const variants = [
  { name: "syncr-logo-white-on-transparent", fg: "#FFFFFF", accent: "#1DB954", bg: null },
  { name: "syncr-logo-white-on-black", fg: "#FFFFFF", accent: "#1DB954", bg: "#000000" },
  { name: "syncr-logo-black-on-white", fg: "#0A0A0A", accent: "#1DB954", bg: "#FFFFFF" },
  { name: "syncr-logo-black-on-transparent", fg: "#0A0A0A", accent: "#1DB954", bg: null },
];

async function run() {
  for (const v of variants) {
    const svg = buildSvg({ fg: v.fg, accent: v.accent, bg: v.bg });
    const svgPath = join(OUT_DIR, `${v.name}.svg`);
    writeFileSync(svgPath, svg);
    console.log(`✓ ${svgPath}`);

    // Render PNG at multiple resolutions
    const buf = Buffer.from(svg);
    for (const w of [512, 1024, 2048]) {
      const out = join(OUT_DIR, `${v.name}-${w}.png`);
      await sharp(buf, { density: 300 })
        .resize({ width: w })
        .png()
        .toFile(out);
      console.log(`✓ ${out}`);
    }
  }
  console.log("\nDone. Files in:", OUT_DIR);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
