import json, glob, numpy as np, pandas as pd
def load(f):
    j=json.load(open(f)); df=pd.DataFrame(j['candles']); df['dt']=pd.to_datetime(df['time'],unit='s')+pd.Timedelta(hours=5,minutes=30); return j['meta']['symbol'],df.set_index('dt')
d={}
for f in glob.glob('data/history/*_5m.json'):
    s,df=load(f); d[s]=df
n=d.pop('NIFTY 50')
print("5m data: %d stocks, %s to %s, Nifty bars %d"%(len(d),n['date'].iloc[0],n['date'].iloc[-1],len(n)))
# ---- Nifty first 30 minutes vs rest of day
def day_stats(df):
    out={}
    for day,g in df.groupby('date'):
        if len(g)<70: continue
        o=g['open'].iloc[0]; f30=g['close'].iloc[5]; c=g['close'].iloc[-1]
        out[day]=dict(first30=f30/o-1, rest=c/f30-1, full=c/o-1)
    return pd.DataFrame(out).T
N=day_stats(n)
x=N['first30']; y=N['rest']
print("\n=== Nifty: first 30 min (09:15-09:45) vs REST of day ===  days=%d"%len(N))
print("corr %.2f ; same direction %.0f%% of days ; (50%% = coin flip)"%(np.corrcoef(x,y)[0,1], (np.sign(x)==np.sign(y)).mean()*100))
big=x.abs()>x.abs().median()
print("when first-30 move is big (top half): same direction %.0f%% of %d days"%((np.sign(x[big])==np.sign(y[big])).mean()*100,big.sum()))
# ---- Stocks: do they follow Nifty's first 30 min, and does Nifty's first 30 min predict stock's rest of day?
rows=[]
for s,df in d.items():
    S=day_stats(df); idx=S.index.intersection(N.index)
    if len(idx)<40: continue
    a=N.loc[idx,'first30']; b=S.loc[idx,'rest']
    rows.append(dict(sym=s,days=len(idx),corr_n30_stock_rest=np.corrcoef(a,b)[0,1],same_dir=(np.sign(a)==np.sign(b)).mean()*100,
        corr_stock30_rest=np.corrcoef(S.loc[idx,'first30'],b)[0,1]))
R=pd.DataFrame(rows).set_index('sym').round(2).sort_values('corr_n30_stock_rest',ascending=False)
print("\n=== Does Nifty's first 30 min predict each stock's rest of day? (noise level about +-0.25 for ~60 days) ===")
print(R)
print("average corr %.2f"%R['corr_n30_stock_rest'].mean())
# ---- bar-level lead-lag (5m): stock return at t vs Nifty return at t+1, and the reverse
rows=[]
nr=n['close'].pct_change()
for s,df in d.items():
    r=df['close'].pct_change(); idx=r.dropna().index.intersection(nr.dropna().index)
    # drop first bar of each day (overnight gap)
    keep=[t for t in idx if not (t.hour==9 and t.minute==15)]
    r=r.loc[keep]; m=nr.loc[keep]
    same=np.corrcoef(r,m)[0,1]
    a=r.iloc[:-1].values; b=m.iloc[1:].values; lead=np.corrcoef(a,b)[0,1]
    a=m.iloc[:-1].values; b=r.iloc[1:].values; lag=np.corrcoef(a,b)[0,1]
    rows.append(dict(sym=s,same_bar=same,stock_leads_nifty=lead,nifty_leads_stock=lag))
L=pd.DataFrame(rows).set_index('sym').round(3)
print("\n=== 5-minute bars: same-bar link, and lead/lag (noise level about +-0.03) ===")
print(L.sort_values('same_bar',ascending=False))
# ---- time of day: when does Nifty move most
n2=n.copy(); n2['ret']=(n2['close']/n2['open']-1).abs()*100; n2['slot']=n2.index.strftime('%H:%M')
tod=n2.groupby('slot')['ret'].mean()
print("\n=== Average size of a 5m Nifty move by time (%) : busiest / quietest ===")
print(tod.sort_values(ascending=False).head(6).round(3).to_dict()); print(tod.sort_values().head(4).round(3).to_dict())
