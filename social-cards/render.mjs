// Renders each social-cards/<name>-card.html to img/<name>-social-card.png at 1200x630.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(dir, '..');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('-card.html'))) {
  await p.goto('file://' + path.join(dir, f), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  const out = path.join(root, 'img', f.replace('-card.html', '-social-card.png'));
  await (await p.$('.c')).screenshot({ path: out });
  console.log('rendered', out);
}
await b.close();
