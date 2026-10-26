# "Confluence ribbon": per-bar causal score -6..+6 from 6 factors (VWAP side, EMA9/21, vs day open, ORB side, RSI, position in day range).
# Test: does the score predict the next 6 bars (30 min)? Forward return signed by score direction, cost 0.08% round trip. Halves split by date.
import json,glob,numpy as np,pandas as pd
src=open('analysis/pine_nifty_test.py').read().split("def bt(")[0]; exec(src)
rows=[]
for f in sorted(glob.glob('data/movers/5m/*_5m.json')):
    j=json.load(open(f)); df=pd.DataFrame(j['candles'])[['date','clock','open','high','low','close','volume']]
    if len(df)<1000 or j['meta']['symbol'] in('NIFTY_50','BANK_NIFTY'): continue
    df=prep(df.reset_index(drop=True)); g=df.groupby('date')
    df['do']=g.open.transform('first'); df['dh']=g.high.cummax(); df['dl']=g.low.cummin()
    o3h=g.high.transform(lambda s:s.iloc[:3].max()); o3l=g.low.transform(lambda s:s.iloc[:3].min())
    cnt=g.cumcount()
    sc=np.sign(df.close-df.vwap).fillna(0)+np.sign(df.ef-ema(df.close,21))*0+np.sign(ema(df.close,9)-ema(df.close,21))+np.sign(df.close-df['do'])
    sc+=np.where(cnt>=3,np.where(df.close>o3h,1,np.where(df.close<o3l,-1,0)),0)
    sc+=np.where(df.rsi>=55,1,np.where(df.rsi<=45,-1,0))
    pos=(df.close-df.dl)/(df.dh-df.dl).replace(0,np.nan); sc+=np.where(pos>0.7,1,np.where(pos<0.3,-1,0))
    df['sc']=sc; df['fwd']=df.groupby('date').close.shift(-6)/df.close-1
    d=df[(df.clock>='10:00')&(df.clock<='14:30')&df.fwd.notna()][['date','sc','fwd']]; rows.append(d)
D=pd.concat(rows); h=sorted(D.date.unique())[len(D.date.unique())//2]
print('bars',len(D))
for name,mask in(('ALL',D.date>='0'),('H1',D.date<h),('H2',D.date>=h)):
    print(name)
    for s in range(-6,7):
        x=D[mask&(D.sc==s)]
        if len(x)<200: continue
        sign=1 if s>0 else -1 if s<0 else 0
        net=(x.fwd*sign-0.0008) if sign else x.fwd
        print(f"  score {s:+d} n={len(x):6d} avgFwd30m={100*x.fwd.mean():+.3f}%  dirNet={100*net.mean():+.3f}%  up%={100*(x.fwd>0).mean():.1f}")
