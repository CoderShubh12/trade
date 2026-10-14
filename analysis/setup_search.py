"""
Setup search (offline, history only). Tests 3 rule families x stop/target widths x time window x cost filter.
Honest protocol: configs are RANKED on the first 70% of days only; the winner(s) are then reported on the
last 30% (never used for choosing). Many configs are tried, so a train winner that fails on test is expected
to be luck. PASS needs on TEST: n>=100, PF>=1.3, net/trade>0.
Costs ~ Rs 40 + 0.035% of notional; risk Rs 500/trade; fill = next open +/- 0.03% slippage;
same-bar stop+target => stop (conservative); exit by 15:15.
"""
import glob, json, itertools, sys
import numpy as np, pandas as pd

RISK, SLIP = 500.0, 0.0003
TF = int(sys.argv[1]) if len(sys.argv) > 1 else 5  # 5 or 15 (minutes)
NOR = 30 // TF  # bars in the 30-minute opening range



def cost(n): return 40.0 + 0.00035 * n


def pf(x):
    w, l = x[x > 0].sum(), -x[x < 0].sum()
    return w / l if l > 0 else (np.inf if w > 0 else 0)


def load():
    out = {}
    for f in sorted(glob.glob("data/movers/5m/*_5m.json")):
        df = pd.DataFrame(json.load(open(f))["candles"])
        df = df[df.volume > 0].reset_index(drop=True)
        if TF == 15:
            m = (df.clock.str[:2].astype(int) * 60 + df.clock.str[3:].astype(int) - 555) // 15
            df["b"] = df.date + "_" + m.astype(str)
            df = df.groupby("b", sort=False).agg(date=("date", "first"), clock=("clock", "first"), open=("open", "first"),
                                                 high=("high", "max"), low=("low", "min"), close=("close", "last"),
                                                 volume=("volume", "sum")).reset_index(drop=True)
        df["ema20"] = df.close.ewm(span=20, adjust=False).mean()
        df["ema60"] = df.close.ewm(span=60, adjust=False).mean()
        tr = pd.concat([df.high - df.low, (df.high - df.close.shift()).abs(), (df.low - df.close.shift()).abs()], axis=1).max(axis=1)
        df["atr"] = tr.rolling(14).mean()
        out[f.split("/")[-1].replace("_5m.json", "")] = df
    return out


def signals(g, fam):
    """yield (k, side) at most once per day. g = one day's candles (reset index)."""
    tp = (g.high + g.low + g.close) / 3
    vwap = ((tp * g.volume).cumsum() / g.volume.cumsum()).values
    c, h, l, v = g.close.values, g.high.values, g.low.values, g.volume.values
    e20, e60, atr = g.ema20.values, g.ema60.values, g.atr.values
    clk = g.clock.values
    orh, orl = h[:NOR].max(), l[:NOR].min()  # 09:15-09:45 opening range
    for k in range(NOR, len(g) - 2):
        if clk[k] < "09:45" or clk[k] > "14:30" or not atr[k] or np.isnan(atr[k]):
            continue
        a = atr[k]
        if fam == "ORB":
            if c[k] > orh and c[k - 1] <= orh and c[k] > vwap[k] and c[k] > e60[k]: yield k, 1
            if c[k] < orl and c[k - 1] >= orl and c[k] < vwap[k] and c[k] < e60[k]: yield k, -1
        elif fam == "PULLBACK":  # trend (ema20>ema60 & price>vwap), dip to ema20 then close back above
            up = e20[k] > e60[k] and c[k] > vwap[k]
            dn = e20[k] < e60[k] and c[k] < vwap[k]
            if up and l[k] <= e20[k] and c[k] > e20[k] and c[k] > c[k - 1]: yield k, 1
            if dn and h[k] >= e20[k] and c[k] < e20[k] and c[k] < c[k - 1]: yield k, -1
        elif fam == "VWAPFADE":  # stretched >2 ATR from vwap, reversal candle
            d = (c[k] - vwap[k]) / a
            if d < -2 and c[k] > g.open.values[k]: yield k, 1
            if d > 2 and c[k] < g.open.values[k]: yield k, -1
        else:
            return


def simulate(g, k, side, atr, stop_atr, tgt_atr):
    o, h, l, c, clk = g.open.values, g.high.values, g.low.values, g.close.values, g.clock.values
    entry = o[k + 1] * (1 + SLIP * side)
    stop, tgt = entry - side * stop_atr * atr, entry + side * tgt_atr * atr
    px = c[-1]
    for j in range(k + 1, len(g)):
        if (l[j] <= stop) if side == 1 else (h[j] >= stop): px = stop; break
        if (h[j] >= tgt) if side == 1 else (l[j] <= tgt): px = tgt; break
        if clk[j] >= "15:15": px = c[j]; break
    px *= (1 - SLIP * side)
    qty = RISK / (stop_atr * atr)
    net = side * (px - entry) * qty - cost(qty * entry)
    return net / RISK, stop_atr * atr / entry * 100


def main():
    data = load()
    # pre-collect first signal per (family, stock, day)
    sigs = []
    for fam in ("ORB", "PULLBACK", "VWAPFADE"):
        for sym, df in data.items():
            for date, g in df.groupby("date", sort=True):
                g = g.reset_index(drop=True)
                for k, side in signals(g, fam):
                    sigs.append((fam, sym, date, g, k, side))
                    break
    days = sorted({s[2] for s in sigs})
    cut = days[int(len(days) * 0.7)]
    print(f"TF={TF}m days={len(days)} train < {cut} <= test; raw signals={len(sigs)}")
    grid = list(itertools.product(("ORB", "PULLBACK", "VWAPFADE"), ((1.5, 2.0, 3.0) if TF == 5 else (1.0, 1.5, 2.0, 3.0)), ((2.0, 3.0, 4.5) if TF == 5 else (2.0, 3.0, 4.5, 6.0)), ("all", "morning"), (0.0, 0.5)))
    rows = []
    for fam, sa, ta, win, minstop in grid:
        if ta <= sa: continue
        tr, te = [], []
        for f, sym, date, g, k, side in sigs:
            if f != fam: continue
            if win == "morning" and g.clock.values[k] > "11:30": continue
            atr = g.atr.values[k]
            if atr / g.close.values[k] * 100 * sa < minstop: continue  # cost filter: skip tiny stops
            r, _ = simulate(g, k, side, atr, sa, ta)
            (tr if date < cut else te).append(r)
        tr, te = np.array(tr), np.array(te)
        if len(tr) < 100: continue
        rows.append(dict(fam=fam, stop=sa, tgt=ta, win=win, minstop=minstop, ntr=len(tr), pf_tr=pf(tr), r_tr=tr.mean(),
                         nte=len(te), pf_te=pf(te) if len(te) else np.nan, r_te=te.mean() if len(te) else np.nan,
                         win_te=100 * (te > 0).mean() if len(te) else np.nan))
    r = pd.DataFrame(rows).sort_values("pf_tr", ascending=False)
    pd.set_option("display.width", 200)
    print(f"\nconfigs with >=100 train trades: {len(r)}  (chosen by TRAIN pf only)\n")
    print("TOP 8 by train PF -> their TEST result:")
    print(r.head(8).round(2).to_string(index=False))
    print("\nTest-set summary over ALL configs: median PF_te=%.2f, share with PF_te>=1.3: %.1f%%" % (r.pf_te.median(), 100 * (r.pf_te >= 1.3).mean()))
    best = r.head(1).iloc[0]
    ok = best.nte >= 100 and best.pf_te >= 1.3 and best.r_te > 0
    print("\nBest-by-train on TEST: n=%d PF=%.2f net/trade=%+.3fR -> %s" % (best.nte, best.pf_te, best.r_te, "PASS" if ok else "FAIL"))


if __name__ == "__main__":
    main()
