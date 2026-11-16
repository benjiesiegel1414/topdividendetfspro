// Dividend history for every ETF in the PRO Terminal sheet and the WeeklyETFs sheet.
// Source: Yahoo Finance dividend events (about 2 years). Output: data/div/SYM.json
// { sym, src, updated, px, pxDate, chg, rows: [[YYYY-MM-DD, amount], ...] } newest first (px = latest close, chg = % vs prior close). Used by weeklyetfs.com/etf.html and the PRO terminal.
// A ticker that Yahoo can't price keeps its existing file.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "data", "div");
const SHEETS = [
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxCiod-Cwry7E6k9Un9dgrM_ANymC36_IO_wLyNj-YDo2KI7mp_1ZzyNBnBGZOxT48QPM8TCwtsmA4/pub?gid=0&single=true&output=csv",
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT1P00pQ6hNvYolxzrKYIuxC-AH1xFBpMtsn-NwC17W4vQazk3ql69ZmSmW8J-jp7OaUmKLV5v2KPI3/pub?gid=0&single=true&output=csv",
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function symbols() {
  const set = new Set();
  for (const u of SHEETS) {
    try {
      const t = await (await fetch(u)).text();
      t.split(/\r?\n/).slice(1).forEach(l => { const s = (l.split(",")[0] || "").replace(/"/g, "").trim().toUpperCase(); if (/^[A-Z.\-]{1,6}$/.test(s)) set.add(s); });
    } catch (e) { console.log("sheet failed", u, e.message); }
  }
  return [...set];
}
async function divs(sym) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d&events=div`, { headers: { "user-agent": "Mozilla/5.0" } });
      if (r.ok) {
        const res = (await r.json()).chart?.result?.[0];
        if (!res) return null;
        const ev = res.events?.dividends || {};
        const ts = res.timestamp || [], cl = res.indicators?.quote?.[0]?.close || [];
        const closes = ts.map((t, i) => [t, cl[i]]).filter(p => p[1] != null && p[1] > 0);
        const last = closes[closes.length - 1], prev = closes[closes.length - 2];
        const rows = Object.values(ev).filter(d => d.amount > 0)
          .map(d => [new Date(d.date * 1000).toISOString().slice(0, 10), Math.round(d.amount * 10000) / 10000])
          .sort((x, y) => (x[0] < y[0] ? 1 : -1));
        rows.px = last ? Math.round(last[1] * 100) / 100 : null;
        rows.pxDate = last ? new Date(last[0] * 1000).toISOString().slice(0, 10) : null;
        rows.chg = last && prev ? Math.round((last[1] / prev[1] - 1) * 1000) / 10 : null;
        return rows;
      }
      if (r.status === 404) return null;
    } catch {}
    await sleep(1500);
  }
  return null;
}
fs.mkdirSync(DIR, { recursive: true });
const syms = await symbols();
const today = new Date().toISOString().slice(0, 10);
let ok = 0, kept = 0;
for (const s of syms) {
  const rows = await divs(s);
  const file = path.join(DIR, s + ".json");
  if (rows && rows.length) { fs.writeFileSync(file, JSON.stringify({ sym: s, src: "yahoo", updated: today, px: rows.px, pxDate: rows.pxDate, chg: rows.chg, rows })); ok++; }
  else if (!fs.existsSync(file) && rows) { fs.writeFileSync(file, JSON.stringify({ sym: s, src: "yahoo", updated: today, rows: [] })); }
  else kept++;
  await sleep(250);
}
console.log(`dividends: ${ok} updated, ${kept} kept/skipped, ${syms.length} symbols`);
