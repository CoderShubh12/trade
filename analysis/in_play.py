"""
Intraday "stocks in play" test (offline, 5m history, costs included, 70/30 chronological split).
Idea: trade only the few stocks with a real catalyst-like footprint at 09:45 (big gap + heavy opening volume),
few trades per day, hold to 15:15 with the opening-range opposite side as the stop (bigger moves vs cost).
Direction: FOLLOW the first-30-min move, or FADE it. 16 pre-defined configs (no mining). Rank on train, report test.
Risk Rs 500/trade, notional cap Rs 5 lakh (5x on 1 lakh), cost = Rs 40 + 0.035% notional, slippage 0.03%.
"""
import glob, json, itertools
import numpy as np, pandas as pd

RISK, SLIP, CAP = 500.0, 0.0003, 500000.0


def cost(n): return 40.0 + 0.00035 * n


def pf(x):
    w, l = x[x > 0].sum(), -x[x < 0].sum()
    return w / l if l > 0 else (np.inf if w > 0 else 0)


def build():
    rows = []
    for f in sorted(glob.glob("data/movers/5m/*_5m.json")):
        sym = f.split("/")[-1].replace("_5m.json", "")
        df = pd.DataFrame(json.load(open(f))["candles"])
        df = df[df.volume > 0]
        days = {d: g.reset_index(drop=True) for d, g in df.groupby("date", sort=True)}
        keys = sorted(days)
        first30 = {d: days[d].volume.iloc[:6].sum() for d in keys}
        for i, d in enumerate(keys):
            g = days[d]
            if i < 10 or len(g) < 60:
                continue
            pc = days[keys[i - 1]].close.iloc[-1]
            avg30 = np.mean([first30[k] for k in keys[i - 10:i]])
            orh, orl = g.high.iloc[:6].max(), g.low.iloc[:6].min()
            entry_px = g.open.iloc[6]  # 09:45 candle open
            ret30 = g.close.iloc[5] / g.open.iloc[0] - 1
            gap = g.open.iloc[0] / pc - 1
            relv = first30[d] / avg30 if avg30 else 0
            end = g[g.clock <= "15:15"].iloc[-1].close
            # path for stop check
            rows.append(dict(sym=sym, date=d, gap=gap * 100, ret30=ret30 * 100, relv=relv, orh=orh, orl=orl,
                             entry=entry_px, end=end, lo=g.low.iloc[6:].values, hi=g.high.iloc[6:].values,
                             cl=g.close.iloc[6:].values, clk=g.clock.iloc[6:].values))
    return rows


def trade(r, side, use_stop):
    entry = r["entry"] * (1 + SLIP * side)
    stop = (r["orl"] if side == 1 else r["orh"])
    risk_px = abs(entry - stop)
    if risk_px <= 0 or risk_px / entry > 0.04:
        return None
    qty = min(RISK / risk_px, CAP / entry)
    px = r["end"]
    if use_stop:
        for lo, hi, c, k in zip(r["lo"], r["hi"], r["cl"], r["clk"]):
            if k > "15:15": break
            if (lo <= stop) if side == 1 else (hi >= stop):
                px = stop; break
    px *= (1 - SLIP * side)
    return (side * (px - entry) * qty - cost(qty * entry)) / RISK


def main():
    rows = build()
    days = sorted({r["date"] for r in rows})
    cut = days[int(len(days) * 0.7)]
    print(f"stock-days={len(rows)} days={len(days)} train < {cut} <= test")
    res = []
    for gmin, rv, mode, stop in itertools.product((0.5, 1.0), (1.5, 2.5), ("follow", "fade"), (True, False)):
        tr, te = [], []
        for r in rows:
            if abs(r["gap"]) < gmin or r["relv"] < rv:
                continue
            m = np.sign(r["ret30"]) if r["ret30"] != 0 else 0
            if m == 0 or np.sign(r["gap"]) != m:
                continue  # need gap and first-30-min move to agree
            side = int(m) if mode == "follow" else -int(m)
            x = trade(r, side, stop)
            if x is None:
                continue
            (tr if r["date"] < cut else te).append(x)
        tr, te = np.array(tr), np.array(te)
        res.append(dict(gap=gmin, relv=rv, mode=mode, stop=stop, ntr=len(tr), pf_tr=pf(tr) if len(tr) else np.nan,
                        r_tr=tr.mean() if len(tr) else np.nan, nte=len(te), pf_te=pf(te) if len(te) else np.nan,
                        r_te=te.mean() if len(te) else np.nan, win_te=100 * (te > 0).mean() if len(te) else np.nan))
    r = pd.DataFrame(res).sort_values("pf_tr", ascending=False)
    pd.set_option("display.width", 200)
    print(r.round(2).to_string(index=False))
    ok = r[(r.ntr >= 30)]
    best = ok.iloc[0] if len(ok) else None
    if best is not None:
        print("\nBest-by-train (>=30 train trades) on TEST: n=%d PF=%.2f net/trade=%+.3fR" % (best.nte, best.pf_te, best.r_te))
        print("PASS" if best.nte >= 100 and best.pf_te >= 1.3 and best.r_te > 0 else "FAIL (or too few trades: need >=100 test trades and PF>=1.3)")


if __name__ == "__main__":
    main()
