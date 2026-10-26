# NSE port of the US "trader-scanner" daily setups, on daily closes (8y, 44 stocks): breakout_20d, bull_flag, reclaim_ma20, oversold (RSI14<30), oversold_bounce.
# Signal at close of day t; long-only entry at close t, exit close t+1 (and t+5). Cost 0.1% round trip. Compared with the all-days baseline. Halves by date.
import json,glob,numpy as np,pandas as pd
rows=[]
for f in sorted(glob.glob('data/movers/daily/*_1d.json')):
    j=json.load(open(f)); df=pd.DataFrame(j['candles'])
    if len(df)<300 or 'NIFTY' in f: continue
    c=df.close; ma=c.rolling(20).mean(); d=c.diff(); up=d.clip(lower=0).ewm(alpha=1/14,adjust=False).mean(); dn=(-d).clip(lower=0).ewm(alpha=1/14,adjust=False).mean(); rsi=100-100/(1+up/dn)
    prior20=c.shift(1).rolling(20).max()
    s=pd.DataFrame({'date':df.date,'breakout_20d':c>prior20,
      'bull_flag':(c.shift(5)/c.shift(15)-1>0.10)&((c.rolling(5).max()-c.rolling(5).min())/c.rolling(5).min()<0.05),
      'reclaim_ma20':(c.shift(1)<ma.shift(1))&(c>ma),'oversold':rsi<30,'oversold_bounce':(rsi.shift(1)<30)&(c>c.shift(1)),
      'r1':c.shift(-1)/c-1,'r5':c.shift(-5)/c-1}).dropna(subset=['r1','r5']); s['sym']=f; rows.append(s.iloc[25:])
D=pd.concat(rows); h=sorted(D.date.unique())[len(D.date.unique())//2]; COST=0.001
def line(name,x):
    out=[]
    for col in('r1','r5'):
        v=x[col]-COST; t=v.mean()/(v.std()/np.sqrt(len(v))) if len(v)>2 and v.std()>0 else 0
        out.append(f"{col}: net={100*v.mean():+.3f}% win={100*(v>0).mean():.0f}% t={t:+.1f}")
    print(f"{name:16s} n={len(x):6d} | "+" | ".join(out))
line('ALL DAYS',D)
for k in('breakout_20d','bull_flag','reclaim_ma20','oversold','oversold_bounce'):
    x=D[D[k]]; line(k,x); line('  H1',x[x.date<h]); line('  H2',x[x.date>=h])
