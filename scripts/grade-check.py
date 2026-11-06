#!/usr/bin/env python3
"""TopDividendETFs grade check.

Re-scores every ETF in the PRO sheet with the published methodology
(https://topdividendetfs.com/how-we-grade-etfs.html) and prints the funds whose
computed grade differs from the grade currently in the sheets.

Usage: python3 grade-check.py [--json out.json]
Needs internet access to Google Sheets (published CSVs) and Yahoo Finance chart data.
"""
import csv, io, json, sys, time, urllib.request, statistics as st

PRO_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxCiod-Cwry7E6k9Un9dgrM_ANymC36_IO_wLyNj-YDo2KI7mp_1ZzyNBnBGZOxT48QPM8TCwtsmA4/pub?gid=0&single=true&output=csv"
TDE_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYVQtSlWkwIDCeeB-YaQEpelovyW9ofaItXrzXZ_ntodK4QasRTKhP-swVWISmXIDZTIvQlbvNZm_o/pub?output=csv"
CASH = {"CSHI", "WEEK", "SGOV"}                      # benchmark: BIL
BOND = {"BNDI", "SCHP", "OVB", "OVM", "OVT", "SPHY"}  # benchmark: AGG
GRADES = [(90,"A+"),(85,"A"),(80,"A-"),(75,"B+"),(70,"B"),(65,"B-"),(60,"C+"),(55,"C"),(50,"C-"),(45,"D+"),(40,"D"),(0,"F")]
ORDER = [g for _, g in GRADES]
YEAR = 31557600

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8")

def chart(sym):
    for _ in range(3):
        try:
            j = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=max&interval=1d&events=div,split"))
            r = j["chart"]["result"][0]
            q = r["indicators"]["quote"][0]["close"]; a = r["indicators"]["adjclose"][0]["adjclose"]
            pts = [(t, c, ad) for t, c, ad in zip(r["timestamp"], q, a) if c and ad]
            divs = sorted((int(k), v["amount"]) for k, v in r.get("events", {}).get("dividends", {}).items())
            if pts: return pts, divs
        except Exception:
            pass
        time.sleep(2)
    return None

def at(pts, t):
    best = pts[0]
    for p in pts:
        if p[0] <= t: best = p
        else: break
    return best

def lerp(x, pts):
    if x <= pts[0][0]: return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]

def score(sym, row, bench):
    data = chart(sym)
    if not data: return None
    pts, divs = data
    now = bench["SPY"][-1][0]
    t0 = pts[0][0]; yrs = (pts[-1][0] - t0) / YEAR
    bm = bench["BIL"] if sym in CASH else bench["AGG"] if sym in BOND else bench["SPY"]
    ann = (pts[-1][2] / pts[0][2]) ** (1 / yrs) - 1 if yrs > 0.25 else None
    b0 = at(bm, max(t0, bm[0][0])); b_ann = (bm[-1][2] / b0[2]) ** (1 / yrs) - 1 if yrs > 0.25 else None
    excess = (ann - b_ann) * 100 if ann is not None else None
    pchg = (pts[-1][1] / pts[0][1] - 1) * 100
    recent = [a for t, a in divs if t >= now - 2 * YEAR]
    cv = st.pstdev(recent) / st.mean(recent) if len(recent) >= 4 else None
    ttm = sum(a for t, a in divs if t >= now - YEAR); prev = sum(a for t, a in divs if now - 2 * YEAR <= t < now - YEAR)
    ttm_chg = (ttm / prev - 1) * 100 if prev > 0 and yrs >= 2 else None
    tot = lambda y0, y1: sum(a for t, a in divs if now - y1 * YEAR <= t < now - y0 * YEAR)
    g3 = ((tot(0, 1) / tot(3, 4)) ** (1 / 3) - 1) * 100 if yrs >= 4.2 and tot(3, 4) > 0 else None
    paid = sum(a for t, a in divs if t >= t0)
    hc = ((paid + pts[-1][1] - pts[0][1]) / pts[0][1]) / yrs * 100 if yrs > 0.25 else None
    try: yld = float(row["yield"].replace("%", "").strip() or 0)
    except ValueError: yld = 0
    tax = row["tax"].strip().upper()[:1]
    s_tr = lerp(excess, [(-15,0),(-10,4),(-5,11),(-2,18),(0,22),(2,25)]) if excess is not None else 13
    if hc is None: s_hc = 12
    elif sym in CASH or sym in BOND: s_hc = lerp(hc, [(0,0),(2,10),(4,19),(6,25)])
    else: s_hc = lerp(hc, [(-10,0),(0,4),(4,10),(8,18),(12,25)])
    s_dec = lerp(pchg, [(-60,0),(-30,4),(-10,9),(0,12),(25,15)])
    if cv is None: s_con = 8
    else:
        s_con = lerp(cv, [(0.1,15),(0.25,11),(0.5,6),(0.8,2),(1.2,0)])
        if ttm_chg is not None and ttm_chg < -20: s_con = max(0, s_con - 4)
        if g3 is not None and g3 >= 5: s_con = min(15, s_con + 3)
    s_tax = {"A":10,"B":7.5,"C":5,"D":2.5,"F":0}.get(tax, 5)
    s_inc = max(lerp(yld, [(0,0),(4,5),(8,10)]), lerp(g3 or 0, [(0,0),(5,5),(10,10)]))
    total = s_tr + s_hc + s_dec + s_con + s_tax + s_inc
    grade = next(g for t, g in GRADES if total >= t)
    cap = "A+" if yrs >= 5 else "A" if yrs >= 3 else "A-" if yrs >= 1 else "B"
    if ORDER.index(grade) < ORDER.index(cap): grade = cap
    return dict(sym=sym, score=round(total, 1), grade=grade, yrs=round(yrs, 1),
                excess=None if excess is None else round(excess, 1), income_paid_back=None if hc is None else round(hc, 1),
                price_change=round(pchg, 1), payout_cv=None if cv is None else round(cv, 2), tax=tax)

def main():
    pro = list(csv.DictReader(io.StringIO(get(PRO_CSV))))
    tde = {r["Symbol"].strip(): r.get("Rating", "").strip().upper() for r in csv.DictReader(io.StringIO(get(TDE_CSV)))}
    bench = {}
    for b in ("SPY", "AGG", "BIL"):
        d = chart(b); bench[b] = d[0]
    out, missing = [], []
    for r in pro:
        sym = (r.get("Symbol") or "").strip()
        if not sym: continue
        row = {"yield": r.get("Dividend Yield", ""), "tax": r.get("Tax Treatment Grade", "")}
        res = score(sym, row, bench)
        time.sleep(0.2)
        if not res: missing.append(sym); continue
        res["pro_grade"] = (r.get("Rating") or "").strip().upper()
        res["tde_grade"] = tde.get(sym, "")
        out.append(res)
    changes = [x for x in out if x["grade"] != x["pro_grade"] or (x["tde_grade"] and x["grade"] != x["tde_grade"])]
    print(f"Scored {len(out)} ETFs, {len(changes)} differ from the current grade. No price data: {', '.join(missing) or 'none'}")
    for x in sorted(changes, key=lambda x: x["sym"]):
        print(f"{x['sym']}: PRO {x['pro_grade'] or '-'} / TDE {x['tde_grade'] or '-'} -> {x['grade']} (score {x['score']})")
    if "--json" in sys.argv:
        json.dump({"all": out, "changes": changes, "missing": missing}, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)

if __name__ == "__main__":
    main()
