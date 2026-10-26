# Time-of-day test: for each entry slot (30 min), enter at bar close with SL/T = +-0.5% (stop checked first), 60-min time stop, cost 0.08%.
# Reports per slot: avg range %, win%, net R (BUY, SELL), split first/second half of the days. Paper research only.
import json, glob, collections
SL=0.005; COST=0.0008; HOLD=12
rows=collections.defaultdict(list)  # (slot,side,half)->R list
rng=collections.defaultdict(list)
files=glob.glob("data/movers/5m/*_5m.json"); dates=set()
data={}
for f in files:
    c=json.load(open(f))["candles"]; by=collections.defaultdict(list)
    for b in c: by[b["date"]].append(b)
    data[f]={d:v for d,v in by.items() if len(v)>=65}; dates|=set(data[f])
ds=sorted(dates); mid=ds[len(ds)//2]
for f,by in data.items():
    for d,bars in by.items():
        half=0 if d<mid else 1
        for i in range(2,len(bars)-HOLD-1):
            b=bars[i]; h,m=map(int,b["clock"].split(":")); mins=h*60+m
            slot=(mins-555)//30
            if slot>=10: continue
            e=b["close"]; rng[(slot,half)].append((b["high"]-b["low"])/e*100)
            for side,dr in (("BUY",1),("SELL",-1)):
                st=e*(1-dr*SL); tg=e*(1+dr*SL); out=None
                for k in range(i+1,i+1+HOLD):
                    x=bars[k]
                    if (x["low"]<=st if dr==1 else x["high"]>=st): out=-1; break
                    if (x["high"]>=tg if dr==1 else x["low"]<=tg): out=1; break
                if out is None: out=((bars[i+HOLD]["close"]-e)*dr)/(e*SL)
                out-=COST/SL
                rows[(slot,side,half)].append(out)
def lab(s): m=555+30*s; return f"{m//60:02d}:{m%60:02d}"
print(f"days {ds[0]}..{ds[-1]}, split at {mid}")
print("slot   avgBar%  | BUY R(h1/h2) n | SELL R(h1/h2) n")
for s in range(10):
    a=[sum(rows[(s,'BUY',h)])/max(1,len(rows[(s,'BUY',h)])) for h in (0,1)]
    b=[sum(rows[(s,'SELL',h)])/max(1,len(rows[(s,'SELL',h)])) for h in (0,1)]
    r=sum(rng[(s,0)]+rng[(s,1)])/max(1,len(rng[(s,0)]+rng[(s,1)]))
    n=len(rows[(s,'BUY',0)])+len(rows[(s,'BUY',1)])
    print(f"{lab(s)}  {r:5.2f}   | {a[0]:+.2f}/{a[1]:+.2f}  {n} | {b[0]:+.2f}/{b[1]:+.2f}")
