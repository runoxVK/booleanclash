/**
 * Screenshot the running app: `npm run shot`.
 *
 * Exists because "it looks wrong" is impossible to fix from a description.
 * Requires the dev server to be up (`npm run dev`).
 */

import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const URL = process.env.SHOT_URL ?? 'http://localhost:5173';
const OUT = 'shots';

const width = Number(process.env.SHOT_W ?? 1440);
const height = Number(process.env.SHOT_H ?? 900);
const name = process.env.SHOT_NAME ?? 'app';
/** Optional JS to run before the shot, e.g. to dismiss the help card. */
const setup = process.env.SHOT_SETUP;

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });

const problems: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle0' });

if (setup) {
  await page.evaluate(setup);
  await new Promise((r) => setTimeout(r, 400));
}

const path = `${OUT}/${name}.png` as const;
await page.screenshot({ path });
await browser.close();

console.log(`wrote ${path}  (${width}x${height})`);
if (problems.length > 0) {
  console.log(`\nconsole errors:\n  ${problems.join('\n  ')}`);
}
