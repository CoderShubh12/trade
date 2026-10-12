import json, glob, numpy as np, pandas as pd
from scipy.optimize import nnls
pd.set_option('display.width',200)
def loadd(f):
    j=json.load(open(f)); df=pd.DataFrame(j['candles']); df['date']=pd.to_datetime(df['date']); return j['meta']['symbol'],df.set_index('date')
D={}
for f in glob.glob('data/movers/daily/*_1d.json'):
    s,df=loadd(f); D[s]=df
N=D.pop('NIFTY 50'); B=D.pop('BANK NIFTY')
close=pd.DataFrame({s:d['close'] for s,d in D.items()}).sort_index()
ret=close.pct_change(fill_method=None)
nr=N['close'].pct_change(); br=B['close'].pct_change()
idx=ret.index.intersection(nr.dropna().index).intersection(br.dropna().index)
ret=ret.loc[idx].fillna(0); nr=nr.loc[idx]; br=br.loc[idx]
print("DAILY: %d stocks, %d days, %s to %s"%(ret.shape[1],len(idx),idx[0].date(),idx[-1].date()))
cut=int(len(idx)*0.7)
def fit(target,cols,label):
    X=ret[cols].values; y=target.values
    w,_=nnls(X[:cut],y[:cut]); 
    def r2(a,b): return 1-((b-a)**2).sum()/((b-b.mean())**2).sum()
    ins=r2(X[:cut]@w,y[:cut]); oos=r2(X[cut:]@w,y[cut:])
    W=pd.Series(w,index=cols); sh=W/W.sum()*100
    print(f"\n=== {label}: best non-negative mix of {len(cols)} stocks | fit on first 70% R2={ins:.2f} | on UNSEEN last 30% R2={oos:.2f} ===")
    print("implied weights %:",sh.sort_values(ascending=False).round(1).head(10).to_dict(),"| weights sum (1.0 = fully explained) %.2f"%W.sum())
    return W
Wn=fit(nr,list(ret.columns),"NIFTY 50")
banks=[c for c in ['HDFCBANK','ICICIBANK','SBIN','KOTAKBANK','AXISBANK','INDUSINDBK','BANKBARODA','PNB','FEDERALBNK','AUBANK','IDFCFIRSTB','BANDHANBNK'] if c in ret]
Wb=fit(br,banks,"BANK NIFTY")
# risk contribution: how much of index variance each stock accounts for
def riskshare(W,target,cols):
    c={s:W[s]*np.cov(ret[s],target)[0,1] for s in cols}; tot=sum(c.values()); return pd.Series(c).div(tot).mul(100).sort_values(ascending=False)
print("\nShare of Nifty's daily ups/downs (risk share %):",riskshare(Wn,nr,list(ret.columns)).round(1).head(10).to_dict())
print("Share of Bank Nifty's daily ups/downs (risk share %):",riskshare(Wb,br,banks).round(1).head(8).to_dict())
# how many stocks are needed? greedy forward selection judged on unseen data
def greedy(target,cols,k):
    chosen=[]
    for _ in range(k):
        best=None
        for c in cols:
            if c in chosen: continue
            X=ret[chosen+[c]].values; w,_=nnls(X[:cut],target.values[:cut]); p=X[cut:]@w; y=target.values[cut:]
            r=1-((y-p)**2).sum()/((y-y.mean())**2).sum()
            if best is None or r>best[1]: best=(c,r)
        chosen.append(best[0]); print("  +%-11s -> unseen R2 %.2f"%best)
    return chosen
print("\nSmallest watch-list for NIFTY (greedy, scored on unseen days):"); gn=greedy(nr,list(ret.columns),8)
print("\nSmallest watch-list for BANK NIFTY:"); gb=greedy(br,banks,5)
# daily lead-lag
rows=[]
nf=nr.shift(-1); bf=br.shift(-1)
for s in ret.columns:
    r=ret[s]; rows.append(dict(sym=s,lead_nifty=np.corrcoef(r[:-1],nr.values[1:])[0,1],lead_bank=np.corrcoef(r[:-1],br.values[1:])[0,1],corr_nifty=np.corrcoef(r,nr)[0,1]))
L=pd.DataFrame(rows).set_index('sym')
print("\nDaily lead-lag: biggest stock-today -> index-tomorrow |corr| (noise level %.3f):"%(2/np.sqrt(len(idx))))
print(L[['lead_nifty','lead_bank']].abs().max().round(3).to_dict())
print("\n=== Correlation with Nifty (top 10) ===");print(L['corr_nifty'].sort_values(ascending=False).round(2).head(10).to_dict())
# ---------- intraday 5m
def load5(f):
    j=json.load(open(f)); df=pd.DataFrame(j['candles']); df['dt']=pd.to_datetime(df['time'],unit='s')+pd.Timedelta(hours=5,minutes=30); return j['meta']['symbol'],df.set_index('dt')
M={}
for f in glob.glob('data/movers/5m/*_5m.json'):
    s,df=load5(f); M[s]=df
n5=M.pop('NIFTY 50'); b5=M.pop('BANK NIFTY')
c5=pd.DataFrame({s:d['close'] for s,d in M.items()})
r5=c5.pct_change(fill_method=None); 
first=r5.index.strftime('%H:%M')=='09:15'
n5r=n5['close'].pct_change(); b5r=b5['close'].pct_change()
common=r5.index.intersection(n5r.index).intersection(b5r.index)
common=[t for t in common if not (t.hour==9 and t.minute==15)]
r5=r5.loc[common]; n5r=n5r.loc[common]; b5r=b5r.loc[common]
print("\n5-MINUTE: %d stocks, %d bars, %s to %s"%(r5.shape[1],len(common),common[0].date(),common[-1].date()))
rows=[]
for s in r5.columns:
    x=r5[s]; m=x.notna()
    xs=x[m]; 
    rows.append(dict(sym=s,same_nifty=np.corrcoef(xs,n5r[m])[0,1],same_bank=np.corrcoef(xs,b5r[m])[0,1],
      lead_nifty=np.corrcoef(xs.values[:-1],n5r[m].values[1:])[0,1],lead_bank=np.corrcoef(xs.values[:-1],b5r[m].values[1:])[0,1]))
T=pd.DataFrame(rows).set_index('sym')
print("Same-bar link, strongest 8 with Nifty:",T['same_nifty'].sort_values(ascending=False).round(2).head(8).to_dict())
print("Same-bar link, strongest 6 with Bank Nifty:",T['same_bank'].sort_values(ascending=False).round(2).head(6).to_dict())
print("Best lead (stock bar t -> index bar t+1): Nifty",T['lead_nifty'].sort_values(ascending=False).round(3).head(4).to_dict(),"| Bank Nifty",T['lead_bank'].sort_values(ascending=False).round(3).head(4).to_dict(),"| noise ~ +-%.3f"%(2/np.sqrt(len(common))))
# Nifty vs Bank Nifty
print("\nBank Nifty vs Nifty: same-bar corr %.2f ; Bank Nifty bar -> Nifty next bar %.3f ; Nifty bar -> Bank next %.3f"%(np.corrcoef(n5r,b5r)[0,1],np.corrcoef(b5r.values[:-1],n5r.values[1:])[0,1],np.corrcoef(n5r.values[:-1],b5r.values[1:])[0,1]))
dn=pd.DataFrame({'n':n5['close'],'b':b5['close']}); dn['date']=dn.index.date
daily=dn.groupby('date').agg(n_o=('n','first'),n_c=('n','last'),b_o=('b','first'),b_c=('b','last'))
print("daily beta of Bank Nifty to Nifty (last 90d): %.2f"%(np.cov(np.log(daily.b_c/daily.b_o),np.log(daily.n_c/daily.n_o))[0,1]/np.var(np.log(daily.n_c/daily.n_o),ddof=1)))
