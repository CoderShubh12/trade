# Same screener-style entries as the research bot (near day high/low, >0.5% move, above/below open, 15-min slots 09:30-14:45, 1 per stock per slot).
# Compare exits: A) current proxy SL = max(0.35*dayRange, 0.3% price), T1=1R; B) vol cone SL = k*sigma*sqrt(6)*price (k=1.0/1.28/1.96), T1 = 1R. 60-min time stop, cost 0.08%.
import json,glob,numpy as np,pandas as pd
def load():
    for f in sorted(glob.glob('data/movers/5m/*_5m.json')):
        j=json.load(open(f)); df=pd.DataFrame(j['candles'])[['date','clock','open','high','low','close','volume']]
        if len(df)<1000 or j['meta']['symbol'] in('NIFTY_50','BANK_NIFTY'): continue
        yield df.reset_index(drop=True)
def run(mode,k=1.28,cost=0.0008):
    out=[]
    for df in load():
        r=np.log(df.close).diff(); r[df.date!=df.date.shift()]=np.nan; sig=r.rolling(24,min_periods=12).std().values
        g=df.groupby('date'); dh=g.high.cummax().values; dl=g.low.cummin().values; do=g.open.transform('first').values
        pcs=g.close.last().shift(1); pc=df.date.map(pcs).values
        H,L,C,CL,DT=df.high.values,df.low.values,df.close.values,df.clock.values,df.date.values
        for i in range(len(df)):
            if not('09:30'<=CL[i]<='14:45' and int(CL[i][3:])%15==0) or np.isnan(pc[i]) or np.isnan(sig[i]): continue
            rng=dh[i]-dl[i]
            if rng<=0: continue
            chg=C[i]/pc[i]-1; pos=(C[i]-dl[i])/rng
            B=chg>0.005 and dh[i]/C[i]-1<0.0025 and pos>0.8 and C[i]>do[i]; S=chg<-0.005 and C[i]/dl[i]-1<0.0025 and pos<0.2 and C[i]<do[i]
            for d,ok in((1,B),(-1,S)):
                if not ok: continue
                e=C[i]; sd=max(0.35*rng,0.003*e) if mode=='A' else k*sig[i]*np.sqrt(6)*e
                sl=e-d*sd; tp=e+d*sd; ex=e
                for j in range(i+1,min(i+13,len(df))):
                    if DT[j]!=DT[i]: break
                    ex=C[j]
                    if (d==1 and L[j]<=sl) or (d==-1 and H[j]>=sl): ex=sl;break
                    if (d==1 and H[j]>=tp) or (d==-1 and L[j]<=tp): ex=tp;break
                    if CL[j]>='15:15': break
                out.append((DT[i],(ex-e)*d/e-cost,((ex-e)*d)/sd))
    T=pd.DataFrame(out,columns=['d','ret','R']).sort_values('d'); m=T.d.iloc[len(T)//2]
    def st(x): w=x.ret[x.ret>0].sum(); l=-x.ret[x.ret<0].sum(); return f"n={len(x)} win={100*(x.ret>0).mean():.1f}% net={100*x.ret.mean():+.3f}% PF={w/max(l,1e-9):.2f}"
    print(mode,k if mode=='B' else '', '| ALL',st(T),'| H1',st(T[T.d<m]),'| H2',st(T[T.d>=m]))
run('A')
for k in(1.0,1.2816,1.96): run('B',k)
