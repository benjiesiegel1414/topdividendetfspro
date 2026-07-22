/**
 * snapshot-history.js
 *
 * Fetches the live PRO Terminal CSV, compares each ticker's Dividend Yield
 * and Total Return against the last recorded snapshot, and appends a new
 * dated data point ONLY when a value actually changed.
 *
 * Output: data/history.json
 *   {
 *     "SCHD": [
 *       { "date": "2026-07-22", "yield": 3.85, "totalReturn": 12.4 },
 *       { "date": "2026-07-25", "yield": 3.91, "totalReturn": 12.9 }
 *     ],
 *     "JEPI": [ ... ]
 *   }
 *
 * Run via GitHub Actions on a schedule (see .github/workflows/snapshot-history.yml).
 * Safe to run more often than the sheet updates — it only writes when something changed.
 */

const fs = require('fs');
const path = require('path');

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxCiod-Cwry7E6k9Un9dgrM_ANymC36_IO_wLyNj-YDo2KI7mp_1ZzyNBnBGZOxT48QPM8TCwtsmA4/pub?gid=0&single=true&output=csv";
const HISTORY_PATH = path.join(__dirname, 'data', 'history.json');

// Column indices match the PRO Terminal table:
// 0 Symbol, 1 Name, 2 Fund Provider, 3 Dividend Yield, 4 Tax Grade,
// 5 Expense Ratio, 6 AUM, 7 Total Return, 8 Price Decay,
// 9 Inception Date, 10 Payout Frequency, 11 Rating
const COL_SYMBOL = 0;
const COL_YIELD = 3;
const COL_TOTAL_RETURN = 7;

function parseNum(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[%,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function parseCsv(text) {
  // Simple split is fine here since this sheet has no embedded commas/newlines
  // in the numeric columns we care about (matches the existing site scripts' approach).
  const lines = text.trim().split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (!cols[COL_SYMBOL]) continue;
    rows.push(cols);
  }
  return rows;
}

function todayCentral() {
  // Date string in America/Chicago, e.g. "2026-07-22"
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(new Date()); // en-CA gives YYYY-MM-DD directly
}

async function main() {
  const res = await fetch(CSV_URL + '&t=' + Date.now());
  if (!res.ok) throw new Error('Failed to fetch CSV: ' + res.status);
  const csvText = await res.text();
  const rows = parseCsv(csvText);

  let history = {};
  if (fs.existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    } catch (e) {
      console.warn('Could not parse existing history.json, starting fresh:', e.message);
      history = {};
    }
  }

  const today = todayCentral();
  let changedCount = 0;
  let newTickerCount = 0;

  for (const cols of rows) {
    const symbol = cols[COL_SYMBOL];
    const yieldVal = parseNum(cols[COL_YIELD]);
    const totalReturnVal = parseNum(cols[COL_TOTAL_RETURN]);

    if (yieldVal === null && totalReturnVal === null) continue;

    if (!history[symbol]) {
      history[symbol] = [];
      newTickerCount++;
    }

    const series = history[symbol];
    const last = series.length ? series[series.length - 1] : null;

    const changed = !last
      || last.yield !== yieldVal
      || last.totalReturn !== totalReturnVal;

    if (changed) {
      // If we already wrote a point today, overwrite it instead of duplicating
      // (handles the case where the Action runs more than once in a day).
      if (last && last.date === today) {
        last.yield = yieldVal;
        last.totalReturn = totalReturnVal;
      } else {
        series.push({ date: today, yield: yieldVal, totalReturn: totalReturnVal });
      }
      changedCount++;
    }
  }

  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');

  console.log(`Snapshot complete: ${rows.length} tickers checked, ${changedCount} updated (${newTickerCount} new), date=${today}`);
}

main().catch(err => {
  console.error('Snapshot failed:', err);
  process.exit(1);
});
