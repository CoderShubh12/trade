# Test of the screener rules swingedge.info lists (Stage 2 trend, 52-week high, volume surge, Darvas-style box breakout, high relative strength).
# Their exact rules are not public, so these are standard textbook versions. 8y daily, 44 stocks (survivorship-biased). Entry next open, 0.1% cost, split 60/40 by date.
import json,glob,statistics as st
C=0.1
D={}
for f in glob.glob("data/movers/daily/*.json"):
    j=json.load(open(f)); D[f]=j["candles"]
alld=sorted({c["date"] for v in D.values() for c in v}); cut=alld[int(len(alld)*0.6)]
def sma(a,i,n): return sum(a[i-n+1:i+1])/n
def rs_rank_factory():
    # 6-month return rank vs the pool (stand-in for RS vs Nifty 500)
    ret={}
    for f,c in D.items():
        for i in range(126,len(c)): ret.setdefault(c[i]["date"],[]).append((c[i]["close"]/c[i-126]["close"]-1,f))
    rk={}
    for d,l in ret.items():
        l.sort(reverse=True)
        for r,(v,f) in enumerate(l): rk[(d,f)]=r/len(l)
    return rk
RK=rs_rank_factory()
def rules(f,c):
    cl=[x["close"] for x in c]; hi=[x["high"] for x in c]; lo=[x["low"] for x in c]; vo=[x.get("volume",0) for x in c]
    out={k:[] for k in ["base","stage2","52w high","vol surge 2x up","darvas box break","top-20% RS","stage2 + top-20% RS"]}
    for i in range(252,len(c)-11):
        m50,m150,m200=sma(cl,i,50),sma(cl,i,150),sma(cl,i,200); m200p=sma(cl,i-20,200)
        st2=cl[i]>m150>m200 and m50>m150 and m200>m200p and cl[i]>m50 and cl[i]>1.3*min(lo[i-251:i+1]) and cl[i]>=0.75*max(hi[i-251:i+1])
        out["base"].append(i)
        if st2: out["stage2"].append(i)
        if cl[i]>=max(hi[i-251:i]): out["52w high"].append(i)
        if vo[i]>2*sum(vo[i-20:i])/20 and cl[i]>cl[i-1]*1.02: out["vol surge 2x up"].append(i)
        box=max(hi[i-20:i]); bl=min(lo[i-20:i])
        if (box-bl)/bl<0.10 and cl[i]>box: out["darvas box break"].append(i)
        r=RK.get((c[i]["date"],f))
        if r is not None and r<0.2: out["top-20% RS"].append(i)
        if st2 and r is not None and r<0.2: out["stage2 + top-20% RS"].append(i)
    return out,cl
for H in (10,):
    res={}
    for f,c in D.items():
        o,cl=rules(f,c)
        for k,idx in o.items():
            last=-99
            for i in idx:
                if k!="base" and i-last<H: continue
                last=i; r=(cl[i+1+H]/c[i+1]["open"]-1)*100-C
                res.setdefault(k,{0:[],1:[]})[0 if c[i]["date"]<cut else 1].append(r)
    print(f"hold {H}d, split {cut}")
    def S(a):
        w=sum(v for v in a if v>0); l=-sum(v for v in a if v<0)
        return f"n={len(a):5d} avg {st.mean(a):+.2f}% win {100*sum(v>0 for v in a)/len(a):.0f}% PF {(w/l if l else 9):.2f}"
    for k,v in res.items(): print(f"{k:22s} TRAIN {S(v[0])} | TEST {S(v[1])}")
