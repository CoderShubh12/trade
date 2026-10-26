# Combine: Pine trend filters (EMA20>EMA50, RSI, ADX/DI, VWAP) + screener-style "near day high / up>0.5% / above open" (BUY) and mirror (SELL).
# Entry on 15-min slots 09:30-14:45 (one BUY + one SELL max per slot), SL=ATR*1.5, T1=1R (research-bot style), 60-min time stop, cost 0.08%.
import json,glob,numpy as np,pandas as pd
src=open('analysis/pine_nifty_test.py').read().split("def bt(")[0]; exec(src)
def run(df,use_pine,cost=0.0008):
    df=prep(df.reset_index(drop=True)); df['dh']=df.groupby('date').high.cummax(); df['dl']=df.groupby('date').low.cummin(); df['do']=df.groupby('date').open.transform('first')
    df['pc']=df.groupby('date').close.transform('last').shift(1)  # approx prev close via shifted day-last (filled below)
    pcs=df.groupby('date').close.last().shift(1); df['pc']=df.date.map(pcs)
    out=[]; i=0; n=len(df)
    for i in range(n):
        r=df.iloc[i]
        if not(('09:30'<=r.clock<='14:45') and int(r.clock[3:])%15==0) or np.isnan(r.pc) or np.isnan(r.adx): continue
        chg=r.close/r.pc-1; rng=r.dh-r.dl
        if rng<=0: continue
        pos=(r.close-r.dl)/rng
        B=chg>0.005 and r.dh/r.close-1<0.0025 and pos>0.8 and r.close>r['do']
        S=chg<-0.005 and r.close/r.dl-1<0.0025 and pos<0.2 and r.close<r['do']
        if use_pine:
            B=B and r.close>r.ef>r.es and r.rsi>=55 and r.close>r.vwap and r.adx>=18 and r.dip>r.dim
            S=S and r.close<r.ef<r.es and r.rsi<=45 and r.close<r.vwap and r.adx>=18 and r.dim>r.dip
        for d,ok in ((1,B),(-1,S)):
            if not ok: continue
            e=r.close; sd=r.atr*1.5; sl=e-d*sd; tp=e+d*sd; ex=None
            for j in range(i+1,min(i+13,n)):
                q=df.iloc[j]
                if q.date!=r.date: break
                if (d==1 and q.low<=sl) or (d==-1 and q.high>=sl): ex=sl;break
                if (d==1 and q.high>=tp) or (d==-1 and q.low<=tp): ex=tp;break
                if q.clock>='15:15': ex=q.close;break
                ex=q.close
            if ex is not None: out.append((r.date,(ex-e)*d/e-cost))
    return out
for use in (False,True):
    T=[]
    for f in sorted(glob.glob('data/movers/5m/*_5m.json')):
        j=json.load(open(f)); df=pd.DataFrame(j['candles'])[['date','clock','open','high','low','close','volume']]
        if len(df)<1000 or j['meta']['symbol'] in('NIFTY_50','BANK_NIFTY'): continue
        T+=[(j['meta']['symbol'],d,x) for d,x in run(df,use)]
    T=pd.DataFrame(T,columns=['s','d','ret']).sort_values('d'); m=T.d.iloc[len(T)//2]
    def st(x): w=x.ret[x.ret>0].sum(); l=-x.ret[x.ret<0].sum(); return f"n={len(x)} win={100*(x.ret>0).mean():.1f}% avgNet={100*x.ret.mean():.3f}% PF={w/max(l,1e-9):.2f}"
    print('PINE+SCREENER' if use else 'SCREENER ONLY','| ALL',st(T),'| H1',st(T[T.d<m]),'| H2',st(T[T.d>=m]))
