# Port of the attached Pine "NIFTY Intraday Quant Strategy v1" (EMA20/50 trend, RSI55/45, VWAP, ADX>=18 + DI, 10-bar breakout,
# ATR*1.5 stop, RR 2, max 3 entries/day, entries 09:20-15:00, flat 15:15). Run on every 5m stock file; cost 0.06% round trip + 0.02% slippage.
import json,glob,numpy as np,pandas as pd
def ema(s,n): return s.ewm(span=n,adjust=False).mean()
def rma(s,n): return s.ewm(alpha=1/n,adjust=False).mean()
def prep(df):
    c,h,l=df.close,df.high,df.low
    df['ef']=ema(c,20); df['es']=ema(c,50)
    d=c.diff(); df['rsi']=100-100/(1+rma(d.clip(lower=0),14)/rma((-d).clip(lower=0),14).replace(0,np.nan))
    tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1); df['atr']=rma(tr,14)
    up=h.diff(); dn=-l.diff(); pdm=np.where((up>dn)&(up>0),up,0.); mdm=np.where((dn>up)&(dn>0),dn,0.)
    a=rma(tr,14); dip=100*rma(pd.Series(pdm,index=df.index),14)/a; dim=100*rma(pd.Series(mdm,index=df.index),14)/a
    df['dip']=dip; df['dim']=dim; df['adx']=rma(100*(dip-dim).abs()/(dip+dim).replace(0,np.nan),14)
    tp=(h+l+c)/3; df['vwap']=(tp*df.volume).groupby(df.date).cumsum()/df.volume.groupby(df.date).cumsum()
    df['hh']=h.rolling(10).max().shift(1); df['ll']=l.rolling(10).min().shift(1); return df
def bt(df,cost=0.0008):
    df=prep(df.reset_index(drop=True)); out=[]; day=None; n=0; pos=None
    for i,r in df.iterrows():
        if r.date!=day: day=r.date; n=0; pos=None
        if pos:
            lo,hi=r.low,r.high; ex=None
            if pos['d']==1: ex=pos['sl'] if lo<=pos['sl'] else (pos['tp'] if hi>=pos['tp'] else None)
            else: ex=pos['sl'] if hi>=pos['sl'] else (pos['tp'] if lo<=pos['tp'] else None)
            if ex is None and r.clock>='15:15': ex=r.close
            if ex is not None: out.append((r.date,(ex-pos['e'])*pos['d']/pos['e']-cost,(ex-pos['e'])*pos['d']/pos['risk'])); pos=None
            continue
        if not('09:20'<=r.clock<='15:00') or n>=3 or np.isnan(r.adx) or np.isnan(r.hh): continue
        sd=r.atr*1.5
        L=r.close>r.ef>r.es and r.rsi>=55 and (r.close>r.vwap or np.isnan(r.vwap)) and r.adx>=18 and r.dip>r.dim and r.close>r.hh
        S=r.close<r.ef<r.es and r.rsi<=45 and (r.close<r.vwap or np.isnan(r.vwap)) and r.adx>=18 and r.dim>r.dip and r.close<r.ll
        if L or S:
            d=1 if L else -1; pos=dict(d=d,e=r.close,sl=r.close-d*sd,tp=r.close+d*sd*2,risk=sd); n+=1
    return out
allt=[]
for f in sorted(glob.glob('data/movers/5m/*_5m.json')):
    j=json.load(open(f)); df=pd.DataFrame(j['candles'])[['date','clock','open','high','low','close','volume']]
    if len(df)<1000: continue
    for d,r,R in bt(df): allt.append((j['meta']['symbol'],d,r,R))
T=pd.DataFrame(allt,columns=['s','d','ret','R']).sort_values('d'); h=T.d.iloc[len(T)//2]
def st(x): 
    w=x.ret[x.ret>0].sum(); l=-x.ret[x.ret<0].sum(); return f"n={len(x)} win={100*(x.ret>0).mean():.1f}% avgNet={100*x.ret.mean():.3f}% PF={w/l:.2f} avgR={x.R.mean():.3f}"
print('ALL ',st(T)); print('H1  ',st(T[T.d<h])); print('H2  ',st(T[T.d>=h]))
for side in ('long','short'): pass
print('trades/day',len(T)/T.d.nunique())
