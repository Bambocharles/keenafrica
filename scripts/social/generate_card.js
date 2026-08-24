#!/usr/bin/env node
// Renders a 1080x1080 branded card image for one opportunity post, for
// sharing to Instagram/Facebook. Reads a JSON payload on stdin:
//   { title, category, categoryLabel, deadline }
// Writes a PNG to the path given as the first CLI argument.
//
// Uses sharp's SVG rasterizer with system fonts (no web-font pipeline,
// keeps this dependency-light and reliable in CI), visually close to the
// site's serif/sans pairing without needing Fraunces/Manrope installed.

import sharp from "sharp";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const T = {
  cream: "#FAF6EC",
  greenDeep: "#15291C",
  terracotta: "#B85C38",
  gold: "#D9A852",
  inkMuted: "#7A6D5E",
  line: "#E3DCC9",
};

const SIZE = 1080;
const PAD = 76;

// The fallback system serif used for rasterizing lacks a few currency
// glyphs (notably the Naira sign), swap in plain-ASCII equivalents for
// the image only. The real ₦ is kept in captions/post text elsewhere,
// where the platform's own font renders it fine.
function sanitizeForRaster(str) {
  return String(str).replace(/₦/g, "NGN ").replace(/\s+/g, " ").trim();
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Crude but serviceable word-wrap: estimate ~0.56em average glyph width
// for the serif headline font, wrap to a target line width in px.
function wrapText(text, fontSize, maxWidth) {
  const avgCharWidth = fontSize * 0.56;
  const maxChars = Math.floor(maxWidth / avgCharWidth);
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error("Usage: generate_card.js <output.png>  (reads JSON from stdin)");
    process.exit(1);
  }

  const input = JSON.parse(readFileSync(0, "utf-8"));
  const title = sanitizeForRaster(input.title);
  const categoryLabel = sanitizeForRaster(input.categoryLabel);
  const deadline = sanitizeForRaster(input.deadline);

  const wrappedTitle = wrapText(title, 64, SIZE - PAD * 2);
  const titleLines = wrappedTitle.slice(0, 4);
  if (wrappedTitle.length > 4) {
    titleLines[3] = titleLines[3].replace(/\s+\S*$/, "") + "…";
  }
  const titleLineHeight = 74;
  const titleStartY = 330;

  const titleTspans = titleLines
    .map(
      (line, i) =>
        `<tspan x="${PAD}" y="${titleStartY + i * titleLineHeight}">${escapeXml(line)}</tspan>`
    )
    .join("");

  const deadlineY = titleStartY + titleLines.length * titleLineHeight + 60;

  const logoPath = join(__dirname, "..", "..", "public", "logo-icon.png");
  const logoBuf = readFileSync(logoPath);
  const logoBase64 = logoBuf.toString("base64");
  const logoSize = 56;

  const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${SIZE}" height="${SIZE}" fill="${T.cream}"/>

  <!-- category badge -->
  <rect x="${PAD}" y="140" width="${categoryLabel.length * 20 + 56}" height="52" rx="26" fill="${T.gold}"/>
  <text x="${PAD + 28}" y="174" font-family="sans-serif" font-size="24" font-weight="700"
        letter-spacing="1.5" fill="${T.greenDeep}">${escapeXml(categoryLabel.toUpperCase())}</text>

  <!-- title -->
  <text font-family="serif" font-size="64" font-weight="500" fill="${T.greenDeep}">${titleTspans}</text>

  <!-- deadline -->
  <text x="${PAD}" y="${deadlineY}" font-family="sans-serif" font-size="28" font-weight="700"
        fill="${T.terracotta}">${escapeXml(deadline)}</text>

  <!-- footer -->
  <line x1="${PAD}" y1="${SIZE - 130}" x2="${SIZE - PAD}" y2="${SIZE - 130}" stroke="${T.line}" stroke-width="2"/>
  <image x="${PAD}" y="${SIZE - 100}" width="${logoSize}" height="${logoSize}"
         href="data:image/png;base64,${logoBase64}"/>
  <text x="${PAD + logoSize + 18}" y="${SIZE - 66}" font-family="sans-serif" font-size="26"
        font-weight="700" fill="${T.greenDeep}">Keen Africa</text>
  <text x="${PAD + logoSize + 18}" y="${SIZE - 36}" font-family="sans-serif" font-size="20"
        fill="${T.inkMuted}">keenafrica.com/blog &#183; Free. No fees. Ever.</text>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
