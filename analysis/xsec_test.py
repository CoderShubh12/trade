# Cross-sectional intraday test (new idea, not previously run): each day rank stocks at 10:15 on gap / relative strength / volume,
# long top-k & short bottom-k (momentum) or reverse (fade), exit 14:30 or 15:15. Cost 0.06% round trip. Split first/second half of days.
import json,glob,os,numpy as np,pandas as pd
D={}
for f in glob.glob('data/movers/5m/*_5m.json'):
    j=json.load(open(f)); df=pd.DataFrame(j['candles']); 
    if len(df)<1000: continue
    D[j['meta']['symbol']]=df
days=sorted(set(d for df in D.values() for d in df.date)); COST=0.0006
rows=[]
for i,d in enumerate(days[1:],1):
    pd_=days[i-1]; r={}
    for s,df in D.items():
        a=df[df.date==d].set_index('clock'); b=df[df.date==pd_]
        if len(b)<60 or '10:15' not in a.index or '14:30' not in a.index or '15:10' not in a.index: continue
        pc=b.close.iloc[-1]; o=a.open.iloc[0]; c1=a.loc['10:15','close']; 
        v1=a.loc[:'10:15','volume'].sum(); vprev=b.loc[b.clock<='10:15','volume'].sum() or 1
        r[s]=dict(gap=o/pc-1, ret=c1/o-1, tot=c1/pc-1, vr=v1/vprev, e=a.loc['10:20','open'] if '10:20' in a.index else c1, x1=a.loc['14:30','close'], x2=a.loc['15:10','close'])
    if len(r)>=25: rows.append((d,pd.DataFrame(r).T))
def run(feat,sign,k,exitc):
    out=[]
    for d,t in rows:
        t=t.copy(); t['rs']=t.ret-t.ret.median(); t['rt']=t.tot-t.tot.median(); f=t[feat]*sign
        top=f.nlargest(k).index; bot=f.nsmallest(k).index
        pnl=[(t.loc[s,exitc]/t.loc[s,'e']-1-COST) for s in top]+[-(t.loc[s,exitc]/t.loc[s,'e']-1)-COST for s in bot]
        out.append(np.mean(pnl))
    return np.array(out)
res=[]
for feat in ['gap','ret','tot','rs','rt','vr']:
  for sign in (1,-1):
    for k in (3,5):
      for ex in ('x1','x2'):
        p=run(feat,sign,k,ex); n=len(p); h=n//2
        res.append(dict(feat=feat,mode='momentum' if sign==1 else 'fade',k=k,exit=ex,days=n,mean=p.mean()*100,t=p.mean()/(p.std()/np.sqrt(n)),h1=p[:h].mean()*100,h2=p[h:].mean()*100,win=(p>0).mean()*100))
R=pd.DataFrame(res).sort_values('t',ascending=False); R.to_csv('analysis/xsec_test.csv',index=False)
print('days',len(rows),'configs',len(R)); print(R.round(3).head(8).to_string()); print(R.round(3).tail(3).to_string())
