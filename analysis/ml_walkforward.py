# PRE-REGISTERED ML test (fixed before running).
# Features (past only, at close of day t): returns 1/5/10/20/60d, 20d vol, RSI14, distance to 20d/55d high,
#  volume ratio, Nifty 5/20d return, cross-sectional ranks of ret5/ret20.
# Target: forward return open(t+1)->open(t+6), cross-sectionally demeaned.
# Models: Ridge (baseline) and shallow HistGradientBoosting. Walk-forward: train on all data before year Y
#  (10-day embargo), test on year Y, Y=2021..2026. Trade every 5th day: long top-5 predicted, equal weight.
# Costs per round trip: 0.40% (STT 0.2%, stamp, slippage 0.1% each side) + Rs 60 fixed on Rs 1 lakh.
# PASS: OOS net mean/period > 0, t>=2, beats the equal-weight universe, and positive in >= 4 of 6 years.
import json, glob, os, numpy as np, pandas as pd
from sklearn.linear_model import Ridge
from sklearn.ensemble import HistGradientBoostingRegressor
from scipy.stats import spearmanr

def load(f):
    d = json.load(open(f))['candles']; df = pd.DataFrame(d); df['date'] = pd.to_datetime(df['date']); return df.set_index('date')
fs = sorted(glob.glob('data/daily/*_1d.json'))
nif = load([f for f in fs if 'NIFTY' in os.path.basename(f).upper()][0])
stk = {os.path.basename(f).replace('_1d.json',''): load(f) for f in fs if 'NIFTY' not in os.path.basename(f).upper()}
nret = nif['close'].pct_change()
rows = []
for s, df in stk.items():
    c, o, v = df['close'], df['open'], df['volume']
    x = pd.DataFrame(index=df.index)
    for n in (1,5,10,20,60): x[f'r{n}'] = c.pct_change(n)
    x['vol20'] = c.pct_change().rolling(20).std()
    dlt = c.diff(); up = dlt.clip(lower=0).rolling(14).mean(); dn = (-dlt.clip(upper=0)).rolling(14).mean()
    x['rsi'] = 100 - 100/(1+up/(dn+1e-9))
    x['d20'] = c/c.rolling(20).max()-1; x['d55'] = c/c.rolling(55).max()-1
    x['vr'] = v/(v.rolling(20).mean()+1)
    x['n5'] = nif['close'].pct_change(5).reindex(df.index); x['n20'] = nif['close'].pct_change(20).reindex(df.index)
    x['y'] = o.shift(-6)/o.shift(-1)-1
    x['stock'] = s; rows.append(x)
D = pd.concat(rows).reset_index().rename(columns={'index':'date'})
D = D.dropna(subset=['r60','vol20','n20']).copy()
D['rk5'] = D.groupby('date')['r5'].rank(pct=True); D['rk20'] = D.groupby('date')['r20'].rank(pct=True)
feat = ['r1','r5','r10','r20','r60','vol20','rsi','d20','d55','vr','n5','n20','rk5','rk20']
D['yd'] = D['y'] - D.groupby('date')['y'].transform('mean')
D = D[D.groupby('date')['stock'].transform('count') >= 20]
COST = 0.0040 + 60/100000
dates = sorted(D['date'].unique())
out = {}
for name in ('ridge','gbm'):
    per = []
    for Y in range(2021, 2027):
        tr = D[(D['date'] < pd.Timestamp(f'{Y}-01-01') - pd.Timedelta(days=14)) & D['yd'].notna()]
        te = D[(D['date'].dt.year == Y)]
        if len(tr) < 5000 or te.empty: continue
        m = Ridge(alpha=10.0) if name=='ridge' else HistGradientBoostingRegressor(max_depth=3, max_iter=150, learning_rate=0.05, min_samples_leaf=200, random_state=0)
        mu, sd = tr[feat].mean(), tr[feat].std()+1e-9
        m.fit(((tr[feat]-mu)/sd).fillna(0), tr['yd'])
        te = te.copy(); te['p'] = m.predict(((te[feat]-mu)/sd).fillna(0))
        ds = sorted(te['date'].unique())[::5]
        for d in ds:
            g = te[(te['date']==d) & te['y'].notna()]
            if len(g) < 20: continue
            top = g.nlargest(5,'p')
            ic = spearmanr(g['p'], g['y']).correlation
            per.append(dict(year=Y, date=d, net=top['y'].mean()-COST, gross=top['y'].mean(), bench=g['y'].mean()-COST, ic=ic))
    P = pd.DataFrame(per); out[name]=P
    n = len(P); t = P['net'].mean()/(P['net'].std()/np.sqrt(n))
    yrs = P.groupby('year')['net'].mean()
    beat = (P['net']-P['bench']).mean()
    ok = P['net'].mean()>0 and t>=2 and beat>0 and (yrs>0).sum()>=4
    print(f"\n== {name.upper()}  {'PASS' if ok else 'FAIL'} ==")
    print(f"periods={n} mean gross/period={P['gross'].mean()*100:.2f}%  net={P['net'].mean()*100:.2f}%  t={t:.2f}  universe(net of same cost)={P['bench'].mean()*100:.2f}%  mean IC={P['ic'].mean():.3f}")
    print("net by year %:", {int(k): round(v*100,2) for k,v in yrs.items()})
