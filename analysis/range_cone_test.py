# Can we predict the RANGE (not direction) of the next 30 min? Band = close +/- z * sigma*sqrt(6), sigma = std of last 24 5m returns (floored by time-of-day mean).
# Check coverage: share of next-6-bar closes inside the 80% band (z=1.2816) and how often max-excursion stays inside it. Halves split by date.
import json,glob,numpy as np,pandas as pd
rows=[]
for f in sorted(glob.glob('data/movers/5m/*_5m.json')):
    j=json.load(open(f)); df=pd.DataFrame(j['candles'])[['date','clock','high','low','close']]
    if len(df)<1000 or j['meta']['symbol'] in('NIFTY_50','BANK_NIFTY'): continue
    r=np.log(df.close).diff(); r[df.date!=df.date.shift()]=np.nan
    sig=r.rolling(24,min_periods=12).std(); f6=df.groupby('date').close.shift(-6)
    hi=df.groupby('date').high.transform(lambda s:s[::-1].rolling(6,min_periods=6).max()[::-1].shift(-1)); lo=df.groupby('date').low.transform(lambda s:s[::-1].rolling(6,min_periods=6).min()[::-1].shift(-1))
    d=pd.DataFrame({'date':df.date,'clock':df.clock,'c':df.close,'sig':sig,'f6':f6,'hi':hi,'lo':lo})
    rows.append(d[(d.clock>='10:00')&(d.clock<='14:30')].dropna())
D=pd.concat(rows); h=sorted(D.date.unique())[len(D.date.unique())//2]
D['z']=np.abs(np.log(D.f6/D.c))/(D.sig*np.sqrt(6))
for z,lab in((1.2816,'80%'),(1.96,'95%')):
    for name,m in(('ALL',D.date>=''),('H1',D.date<h),('H2',D.date>=h)):
        x=D[m]; band=z*x.sig*np.sqrt(6)
        end_in=(np.abs(np.log(x.f6/x.c))<=band).mean()
        path_in=((np.log(x.hi/x.c)<=band)&(np.log(x.lo/x.c)>=-band)).mean()
        print(f"{lab} band {name}: n={len(x)} end-in-band={100*end_in:.1f}%  whole-path-in-band={100*path_in:.1f}%")
# does low recent vol predict a smaller future move? (quintiles of sigma -> mean |move|)
D['q']=pd.qcut(D.sig,5,labels=False); print((D.groupby('q').apply(lambda x:100*np.abs(np.log(x.f6/x.c)).mean())).round(3).to_string())
