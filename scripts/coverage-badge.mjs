#!/usr/bin/env node
/**
 * Writes `.github/badges/coverage.svg` from the coverage summary vitest
 * emits.
 *
 * Deliberately no service and no dependency. Codecov or a shields.io
 * endpoint would both mean either an external account or a public raw URL
 * -- and a raw URL doesn't resolve while a repo is private, so the badge
 * would sit broken until the repo flipped public. A committed SVG
 * referenced by a relative path renders in both states.
 *
 * Run after `npm run test:coverage`.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const summaryPath = path.join(root, "coverage", "coverage-summary.json");
const outPath = path.join(root, ".github", "badges", "coverage.svg");

let summary;
try {
  summary = JSON.parse(await readFile(summaryPath, "utf8"));
} catch {
  console.error(
    `coverage summary not found at ${path.relative(root, summaryPath)} -- run \`npm run test:coverage\` first.`,
  );
  process.exit(1);
}

// Lines is the figure people mean by "coverage" when they don't say which.
const pct = summary.total?.lines?.pct;
if (typeof pct !== "number") {
  console.error("coverage-summary.json has no total.lines.pct");
  process.exit(1);
}

const rounded = Math.round(pct * 10) / 10;
const label = "coverage";
const value = `${rounded}%`;

// Same thresholds/colours shields.io uses for coverage, so the badge reads
// the way people already expect one to.
const color =
  pct >= 90 ? "#4c1" : pct >= 80 ? "#97ca00" : pct >= 70 ? "#a4a61d" : pct >= 60 ? "#dfb317" : pct >= 40 ? "#fe7d37" : "#e05d44";

// Verdana at 11px averages ~6.1px/char; the +10 is the padding each side.
const textWidth = (s) => Math.ceil(s.length * 6.1) + 10;
const labelW = textWidth(label);
const valueW = textWidth(value);
const total = labelW + valueW;

// Coordinates are scaled x10 (textLength/font-size in tenths) which is how
// shields renders crisply at any zoom.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelW * 5}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelW - 10) * 10}">${label}</text>
    <text x="${labelW * 5}" y="140" transform="scale(.1)" textLength="${(labelW - 10) * 10}">${label}</text>
    <text aria-hidden="true" x="${(labelW + valueW / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueW - 10) * 10}">${value}</text>
    <text x="${(labelW + valueW / 2) * 10}" y="140" transform="scale(.1)" textLength="${(valueW - 10) * 10}">${value}</text>
  </g>
</svg>
`;

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, svg);
console.log(`coverage badge: ${value} -> ${path.relative(root, outPath)}`);
