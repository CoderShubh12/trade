import json, glob, os, numpy as np, pandas as pd
D='data/daily'
def load(f):
    j=json.load(open(f)); df=pd.DataFrame(j['candles']); df['date']=pd.to_datetime(df['date']); return j['meta']['symbol'], df.set_index('date')
raw={}
for f in glob.glob(f'{D}/*_1d.json'):
    s,df=load(f); raw[s]=df
nifty=raw.pop('NIFTY 50')
close=pd.DataFrame({s:d['close'] for s,d in raw.items()}).sort_index()
ret=close.pct_change(fill_method=None)
nret=nifty['close'].pct_change()
idx=nret.dropna().index.intersection(ret.index)
ret=ret.loc[idx]; nret=nret.loc[idx]
print("days",len(idx), idx[0].date(), idx[-1].date())
# --- A. dependency table
rows=[]
for s in ret.columns:
    r=ret[s].dropna(); n=nret.loc[r.index]
    if len(r)<500: continue
    c=np.corrcoef(r,n)[0,1]; b=np.cov(r,n)[0,1]/n.var()
    up=n>0; dn=n<0
    bu=np.cov(r[up],n[up])[0,1]/n[up].var(); bd=np.cov(r[dn],n[dn])[0,1]/n[dn].var()
    # recent 2y
    r2=r[-500:]; n2=nret.loc[r2.index]; c2=np.corrcoef(r2,n2)[0,1]
    # lead-lag: does stock today predict nifty tomorrow (and vice versa)?
    nf=nret.shift(-1).loc[r.index]; m=nf.notna()
    l1=np.corrcoef(r[m],nf[m])[0,1]
    sf=r.shift(-1); m2=sf.notna(); l2=np.corrcoef(n[m2],sf[m2])[0,1]
    rows.append(dict(sym=s,days=len(r),corr=c,r2=c*c,beta=b,beta_up=bu,beta_dn=bd,corr_2y=c2,stock_leads_nifty=l1,nifty_leads_stock=l2,vol_ann=r.std()*np.sqrt(252)*100))
T=pd.DataFrame(rows).set_index('sym').sort_values('corr',ascending=False)
pd.set_option('display.width',200); pd.set_option('display.max_rows',100)
print("\n=== Correlation with Nifty (daily), top 12 / bottom 8 ===")
print(T[['corr','r2','beta','beta_up','beta_dn','corr_2y','vol_ann']].round(2).head(12))
print(T[['corr','r2','beta','beta_up','beta_dn','corr_2y','vol_ann']].round(2).tail(8))
print("\nmedian corr %.2f, median beta %.2f"%(T['corr'].median(),T['beta'].median()))
print("\n=== Lead-lag (|corr| > 0.1 would be notable; 2/sqrt(N)=%.3f is noise level) ==="%(2/np.sqrt(len(idx))))
print(T[['stock_leads_nifty','nifty_leads_stock']].abs().max().round(3).to_dict(), " max abs over all stocks")
print(T[['stock_leads_nifty','nifty_leads_stock']].describe().loc[['mean','min','max']].round(3))
# --- bank basket proxy
banks=['SBIN','PNB','CANBK','BANKBARODA','FEDERALBNK','IDFCFIRSTB','UNIONBANK','RBLBANK','BANDHANBNK']
banks=[b for b in banks if b in ret]
bb=ret[banks].mean(axis=1)
print("\n=== Bank basket (equal-weight of %d banks, NOT Bank Nifty) vs Nifty ==="%len(banks), banks)
print("corr %.2f beta %.2f"%(np.corrcoef(bb,nret)[0,1], np.cov(bb,nret)[0,1]/nret.var()))
# --- implied contribution (non-negative least squares): which stocks explain Nifty moves?
from scipy.optimize import nnls
X=ret.fillna(0).values; y=nret.values
w,res=nnls(X,y); pred=X@w
r2=1-((y-pred)**2).sum()/((y-y.mean())**2).sum()
print("\n=== Can these %d stocks explain Nifty? R2 of best non-negative mix = %.2f ==="%(X.shape[1],r2))
W=pd.Series(w,index=ret.columns).sort_values(ascending=False)
print((W/W.sum()*100).round(1).head(8).to_dict())
# --- Nifty conditional behaviour (patterns)
o=nifty['open']; c=nifty['close']; gap=(o/c.shift(1)-1); oc=(c/o-1); nxt=c.pct_change().shift(-1)
def tstat(x): x=x.dropna(); return (len(x), x.mean()*100, x.mean()/(x.std()/np.sqrt(len(x))) if len(x)>2 else np.nan)
print("\n=== Nifty patterns (daily) : n, mean %, t-stat (|t|<2 = indistinguishable from luck) ===")
for name,mask in [("gap up >0.5% -> open-to-close",gap>0.005),("gap down <-0.5% -> open-to-close",gap<-0.005)]:
    print(name, [round(v,2) for v in tstat(oc[mask])])
big=c.pct_change()
print("after Nifty day < -1.5% -> next day", [round(v,2) for v in tstat(nxt[big<-0.015])])
print("after Nifty day > +1.5% -> next day", [round(v,2) for v in tstat(nxt[big>0.015])])
print("after 3 down days in a row -> next day", [round(v,2) for v in tstat(nxt[(big<0)&(big.shift(1)<0)&(big.shift(2)<0)])])
print("all days next-day mean", [round(v,2) for v in tstat(nxt)])
# --- stocks on big Nifty down days: who falls most / least
dn=nret<-0.01; upd=nret>0.01
print("\nBig down days (Nifty < -1%%): %d ; big up days (> +1%%): %d"%(dn.sum(),upd.sum()))
dd=ret[dn].mean().sort_values(); uu=ret[upd].mean().sort_values(ascending=False)
print("falls MOST on big down days (avg %):",(dd.head(6)*100).round(2).to_dict())
print("falls LEAST / rises on big down days:",(dd.tail(6)*100).round(2).to_dict())
print("rises MOST on big up days:",(uu.head(6)*100).round(2).to_dict())
T.to_csv('analysis/daily_dependency.csv')
