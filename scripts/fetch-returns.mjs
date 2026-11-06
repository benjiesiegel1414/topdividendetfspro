// Computes trailing total returns (dividends reinvested) for every ETF in the PRO Terminal sheet.
// Source: Yahoo Finance daily adjusted closes. Output: data/returns.json
// { asOf, funds: { SCHD: { r1y, r3y, r5y, mdd, px, chg, pxDate } } }  px = latest share price, chg = % change vs prior close, pxTime = time of that price  r3y/r5y are annualized; null when the fund is too new.
// mdd = max drawdown (%) over the last 5 years or since inception
// data/growth.json = { SCHD: [[YYYY-MM, value], ...] } weekly growth of $10K [[YYYY-MM-DD, value], ...], used by the scorecard chart
import fs from "node:fs"; import { execSync } from "node:child_process"; import path from "node:path"; import { fileURLToPath } from "node:url";
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
        // latest share price (unadjusted) and the prior close for the daily change
        const cl = (res?.indicators?.quote?.[0]?.close || []).map((c, i) => [ts[i] * 1000, c]).filter(p => p[1] != null && p[1] > 0);
        if (pts.length) {
          pts.price = res?.meta?.regularMarketPrice ?? (cl.length ? cl[cl.length - 1][1] : null);
          pts.prev = cl.length > 1 ? cl[cl.length - 2][1] : null;
          pts.priceDate = cl.length ? new Date(cl[cl.length - 1][0]).toISOString().slice(0, 10) : null;
          pts.priceTime = res?.meta?.regularMarketTime ? res.meta.regularMarketTime * 1000 : null;
          return pts;
        }
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

// worst peak-to-trough drop over the last 5 years (or since inception), dividends reinvested
function drawdown(pts) {
  const from = pts[pts.length - 1][0] - 5 * 365.25 * DAY;
  let peak = 0, worst = 0;
  for (const [t, v] of pts) { if (t < from) continue; if (v > peak) peak = v; const dd = (v / peak - 1) * 100; if (dd < worst) worst = dd; }
  return Math.round(worst * 10) / 10;
}
// growth of $10,000, one point per week (every 5th trading day) plus the latest day, over the last 5 years (or since inception)
function weekly(pts) {
  const from = pts[pts.length - 1][0] - 5 * 365.25 * DAY - 7 * DAY;
  const use = pts.filter(p => p[0] >= from), base = use[0][1], out = [];
  for (let i = 0; i < use.length; i++) {
    if (i % 5 === 0 || i === use.length - 1) out.push([new Date(use[i][0]).toISOString().slice(0, 10), Math.round(10000 * use[i][1] / base)]);
  }
  return out;
}

const csv = await (await fetch(CSV_URL + "&t=" + Date.now())).text();
const syms = [...new Set(csv.trim().split("\n").slice(1).map(l => l.split(",")[0].trim().replace(/^"|"$/g, "")).filter(Boolean))];
const GROWTH_OUT = path.join(ROOT, "data", "growth.json");
const prevGrowth = fs.existsSync(GROWTH_OUT) ? JSON.parse(fs.readFileSync(GROWTH_OUT, "utf8")) : {};
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { funds: {} };
const funds = {}, growth = {}; let ok = 0, failed = [];
for (const s of syms) {
  const pts = await series(s);
  if (!pts) { failed.push(s); if (prev.funds?.[s]) funds[s] = prev.funds[s]; if (prevGrowth[s]) growth[s] = prevGrowth[s]; continue; }
  funds[s] = { r1y: ret(pts, 1), r3y: ret(pts, 3), r5y: ret(pts, 5), mdd: drawdown(pts),
    px: pts.price != null ? Math.round(pts.price * 100) / 100 : null,
    chg: pts.price != null && pts.prev ? Math.round((pts.price / pts.prev - 1) * 1000) / 10 : null, pxDate: pts.priceDate,
    pxTime: pts.priceTime ? new Date(pts.priceTime).toISOString() : null };
  growth[s] = weekly(pts);
  ok++; await sleep(250);
}
// Don't overwrite good data with a mostly failed run
if (ok < syms.length * 0.8) { console.log(`::error::Only ${ok}/${syms.length} funds fetched; keeping previous returns.json. Failed: ${failed.join(" ")}`); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), funds }, null, 1));
fs.writeFileSync(GROWTH_OUT, JSON.stringify(growth));
// The workflow only runs `git add data/returns.json`, so stage growth.json here when running in GitHub Actions
if (process.env.GITHUB_ACTIONS) { try { execSync("git add data/growth.json", { cwd: ROOT }); } catch (e) { console.log("::warning::could not stage growth.json"); } }
console.log(`returns.json: ${ok}/${syms.length} funds${failed.length ? ", failed: " + failed.join(" ") : ""}`);
