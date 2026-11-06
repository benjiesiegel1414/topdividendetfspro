// Computes trailing total returns (dividends reinvested) for every ETF in the PRO Terminal sheet.
// Source: Yahoo Finance daily adjusted closes. Output: data/returns.json
// { asOf, funds: { SCHD: { r1y, r3y, r5y } } }  r3y/r5y are annualized; null when the fund is too new.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "returns.json");
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxCiod-Cwry7E6k9Un9dgrM_ANymC36_IO_wLyNj-YDo2KI7mp_1ZzyNBnBGZOxT48QPM8TCwtsmA4/pub?gid=0&single=true&output=csv";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;

async function series(sym) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=6y&interval=1d&events=div,split`, { headers: { "user-agent": "Mozilla/5.0" } });
      if (r.ok) {
        const res = (await r.json()).chart?.result?.[0];
        const ts = res?.timestamp || [], adj = res?.indicators?.adjclose?.[0]?.adjclose || [];
        const pts = ts.map((t, i) => [t * 1000, adj[i]]).filter(p => p[1] != null && p[1] > 0);
        if (pts.length) return pts;
      }
    } catch {}
    await sleep(1500);
  }
  return null;
}
// adjusted close on or just before a date
function at(pts, t) { let v = null; for (const p of pts) { if (p[0] <= t) v = p; else break; } return v; }
function ret(pts, years) {
  const last = pts[pts.length - 1], start = last[0] - years * 365.25 * DAY;
  if (pts[0][0] > start + 7 * DAY) return null; // not trading long enough
  const s = at(pts, start); if (!s) return null;
  const g = last[1] / s[1];
  const v = years === 1 ? (g - 1) * 100 : (Math.pow(g, 1 / years) - 1) * 100;
  return Math.round(v * 10) / 10;
}

const csv = await (await fetch(CSV_URL + "&t=" + Date.now())).text();
const syms = [...new Set(csv.trim().split("\n").slice(1).map(l => l.split(",")[0].trim().replace(/^"|"$/g, "")).filter(Boolean))];
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { funds: {} };
const funds = {}; let ok = 0, failed = [];
for (const s of syms) {
  const pts = await series(s);
  if (!pts) { failed.push(s); if (prev.funds?.[s]) funds[s] = prev.funds[s]; continue; }
  funds[s] = { r1y: ret(pts, 1), r3y: ret(pts, 3), r5y: ret(pts, 5) };
  ok++; await sleep(250);
}
// Don't overwrite good data with a mostly failed run
if (ok < syms.length * 0.8) { console.log(`::error::Only ${ok}/${syms.length} funds fetched; keeping previous returns.json. Failed: ${failed.join(" ")}`); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), funds }, null, 1));
console.log(`returns.json: ${ok}/${syms.length} funds${failed.length ? ", failed: " + failed.join(" ") : ""}`);
