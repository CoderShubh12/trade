"""
ML trade-quality REJECTOR test (offline, history only; does not touch the live app).

1. Rule-based candidates: 5m range breakout with trend + volume (long and short).
2. Each candidate simulated: entry = next open + 0.03% slippage, stop 1.0 ATR, target 1.5 ATR,
   exit 15:15 at latest. If stop and target are in the same bar, STOP is assumed (conservative).
3. Costs ~ Rs 40 flat + 0.035% of notional (approximation of intraday charges), risk 0.5% of Rs 1 lakh.
4. Walk-forward by DATE (train on the past only, test on the next block). A trade is taken only if the
   model's probability >= threshold. Thresholds are fixed in advance (no tuning on test).
Verdict rule: filtered trades must show PF >= 1.3 and positive net expectancy on out-of-sample trades (n >= 100).
"""
import glob, json, sys
import numpy as np, pandas as pd
from sklearn.ensemble import GradientBoostingClassifier

RISK = 500.0
SLIP = 0.0003
STOP_ATR, TGT_ATR = 1.0, 1.5
THRESHOLDS = [0.50, 0.55, 0.60]
MIN_TRAIN_DAYS, TEST_BLOCK_DAYS = 20, 5


def cost(notional):
    return 40.0 + 0.00035 * notional


def load():
    out = {}
    for f in sorted(glob.glob("data/movers/5m/*_5m.json")):
        d = json.load(open(f))
        df = pd.DataFrame(d["candles"])
        df = df[df.volume > 0].copy()
        out[f.split("/")[-1].replace("_5m.json", "")] = df.reset_index(drop=True)
    return out


def candidates(sym, df):
    rows = []
    df = df.copy()
    df["ema20"] = df.close.ewm(span=20, adjust=False).mean()
    df["ema60"] = df.close.ewm(span=60, adjust=False).mean()
    tr = pd.concat([df.high - df.low, (df.high - df.close.shift()).abs(), (df.low - df.close.shift()).abs()], axis=1).max(axis=1)
    df["atr"] = tr.rolling(14).mean()
    prev_close = {}
    for date, g in df.groupby("date", sort=True):
        idx = g.index.tolist()
        day_open = g.open.iloc[0]
        pc = prev_close.get("v")
        gap = (day_open / pc - 1) * 100 if pc else 0.0
        prev_close["v"] = g.close.iloc[-1]
        tp = (g.high + g.low + g.close) / 3
        vwap = (tp * g.volume).cumsum() / g.volume.cumsum()
        taken = 0
        for k in range(12, len(g) - 2):
            i = idx[k]
            clock = g.clock.iloc[k]
            if clock < "09:45" or clock > "14:30" or taken >= 1:
                continue
            atr = df.atr.iloc[i]
            if not atr or np.isnan(atr) or atr <= 0:
                continue
            hh = g.high.iloc[k - 12:k].max()
            ll = g.low.iloc[k - 12:k].min()
            c = g.close.iloc[k]
            avgv = g.volume.iloc[max(0, k - 12):k].mean()
            relv = g.volume.iloc[k] / avgv if avgv else 0
            side = 0
            if c > hh and c > df.ema20.iloc[i] and relv > 1.2:
                side = 1
            elif c < ll and c < df.ema20.iloc[i] and relv > 1.2:
                side = -1
            if side == 0:
                continue
            entry = g.open.iloc[k + 1] * (1 + SLIP * side)
            stop = entry - side * STOP_ATR * atr
            tgt = entry + side * TGT_ATR * atr
            exit_px, why = None, "time"
            for j in range(k + 1, len(g)):
                hi, lo = g.high.iloc[j], g.low.iloc[j]
                hit_stop = lo <= stop if side == 1 else hi >= stop
                hit_tgt = hi >= tgt if side == 1 else lo <= tgt
                if hit_stop:
                    exit_px, why = stop, "stop"; break
                if hit_tgt:
                    exit_px, why = tgt, "target"; break
                if g.clock.iloc[j] >= "15:15":
                    exit_px = g.close.iloc[j]; break
            if exit_px is None:
                exit_px = g.close.iloc[-1]
            exit_px = exit_px * (1 - SLIP * side)
            qty = RISK / (STOP_ATR * atr)
            notional = qty * entry
            gross = side * (exit_px - entry) * qty
            net = gross - cost(notional)
            mins = int(clock[:2]) * 60 + int(clock[3:])
            rows.append(dict(
                sym=sym, date=date, side=side, net_r=net / RISK, win=int(net > 0),
                atr_pct=atr / c * 100, vwap_d=(c - vwap.iloc[k]) / atr * side,
                ema_slope=(df.ema20.iloc[i] - df.ema20.iloc[max(0, i - 5)]) / atr * side,
                trend60=(c - df.ema60.iloc[i]) / atr * side, relv=relv, mins=mins, gap=gap * side,
                stop_pct=STOP_ATR * atr / c * 100, cost_r=cost(notional) / RISK,
                bar_rng=(g.high.iloc[k] - g.low.iloc[k]) / atr,
                ext=(c - (hh if side == 1 else ll)) / atr * side,
            ))
            taken += 1
    return rows


def pf(x):
    w, l = x[x > 0].sum(), -x[x < 0].sum()
    return w / l if l > 0 else float("inf")


def summarize(name, x):
    if len(x) == 0:
        print(f"{name:28s} n=0"); return
    print(f"{name:28s} n={len(x):4d} win={100*(x>0).mean():5.1f}% PF={pf(x):5.2f} net/trade={x.mean():+.3f}R  total={x.sum():+7.1f}R")


def main():
    data = load()
    rows = []
    for s, df in data.items():
        rows += candidates(s, df)
    c = pd.DataFrame(rows).sort_values(["date", "sym"]).reset_index(drop=True)
    print(f"stocks={len(data)} candidates={len(c)} days={c.date.nunique()} ({c.date.min()} .. {c.date.max()})")
    feats = ["atr_pct", "vwap_d", "ema_slope", "trend60", "relv", "mins", "gap", "stop_pct", "cost_r", "bar_rng", "ext", "side"]
    days = sorted(c.date.unique())
    test_idx = []
    preds = pd.Series(np.nan, index=c.index)
    p = MIN_TRAIN_DAYS
    while p < len(days):
        tr = c[c.date.isin(days[:p])]
        te = c[c.date.isin(days[p:p + TEST_BLOCK_DAYS])]
        if len(tr) >= 60 and tr.win.nunique() == 2 and len(te):
            m = GradientBoostingClassifier(n_estimators=80, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=1)
            m.fit(tr[feats], tr.win)
            preds.loc[te.index] = m.predict_proba(te[feats])[:, 1]
        p += TEST_BLOCK_DAYS
    oos = c[preds.notna()].copy()
    oos["p"] = preds[preds.notna()]
    print(f"out-of-sample trades: {len(oos)}\n")
    summarize("ALL candidates (baseline)", oos.net_r)
    summarize("  long", oos[oos.side == 1].net_r)
    summarize("  short", oos[oos.side == -1].net_r)
    print()
    base = oos.win.mean()
    for t in THRESHOLDS:
        summarize(f"ML keeps p>={t:.2f}", oos[oos.p >= t].net_r)
        summarize(f"ML rejects p<{t:.2f}", oos[oos.p < t].net_r)
    # random control: same number of trades kept as p>=0.55, chosen at random (repeat)
    k = int((oos.p >= 0.55).sum())
    if k >= 10:
        rng = np.random.default_rng(7)
        pfs = [pf(oos.net_r.sample(k, random_state=int(rng.integers(1e9))).values) for _ in range(200)]
        print(f"\nrandom control (k={k}): median PF={np.median(pfs):.2f}, 90th pct PF={np.percentile(pfs, 90):.2f}")
    # half split of OOS trades
    h = len(oos) // 2
    print("\nVerdict check at p>=0.55 (both halves of OOS):")
    for nm, part in (("first half", oos.iloc[:h]), ("second half", oos.iloc[h:])):
        summarize(nm, part[part.p >= 0.55].net_r)
    sel = oos[oos.p >= 0.55].net_r
    ok = len(sel) >= 100 and pf(sel) >= 1.3 and sel.mean() > 0
    print("\nPASS" if ok else "\nFAIL (not enough edge / too few trades) - do NOT put this model in the app")


if __name__ == "__main__":
    main()
