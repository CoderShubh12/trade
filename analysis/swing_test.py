# Swing test on 8y daily data (44 large caps; survivorship-biased: today's liquid names). Entry next-day open, exit after H days at close, cost 0.1% round trip.
# Rules judged: avg net %/trade and PF in first 60% (train) vs last 40% (test) of dates, vs the "buy any day" baseline.
import json, glob, collections, statistics as st
C=0.1
D={}
for f in glob.glob("data/movers/daily/*.json"):
    j=json.load(open(f)); D[j["meta"]["symbol"] if "symbol" in j["meta"] else f]=j["candles"]
alld=sorted({c["date"] for v in D.values() for c in v}); cut=alld[int(len(alld)*0.6)]
def rsi(cl,n=14):
    out=[None]*len(cl); g=l=0
    for i in range(1,len(cl)):
        d=cl[i]-cl[i-1]; u=max(d,0); w=max(-d,0)
        if i<=n: g+=u/n; l+=w/n
        else: g=(g*(n-1)+u)/n; l=(l*(n-1)+w)/n
        if i>=n: out[i]=100-100/(1+g/l) if l else 100
    return out
def ma(cl,n): return [None if i<n-1 else sum(cl[i-n+1:i+1])/n for i in range(len(cl))]
rules={
 "baseline any-day": lambda i,c,cl,m20,m50,m200,r: True,
 "breakout 20d high": lambda i,c,cl,m20,m50,m200,r: i>20 and cl[i]>max(cl[i-20:i]),
 "breakout 55d high": lambda i,c,cl,m20,m50,m200,r: i>55 and cl[i]>max(cl[i-55:i]),
 "RSI<30 bounce": lambda i,c,cl,m20,m50,m200,r: r[i] is not None and r[i]<30,
 "uptrend pullback (>MA200, RSI<40)": lambda i,c,cl,m20,m50,m200,r: m200[i] and cl[i]>m200[i] and r[i] is not None and r[i]<40,
 "reclaim MA20": lambda i,c,cl,m20,m50,m200,r: m20[i-1] and cl[i-1]<m20[i-1] and cl[i]>m20[i],
 "3-day drop >5% in uptrend": lambda i,c,cl,m20,m50,m200,r: m200[i] and cl[i]>m200[i] and i>3 and cl[i]/cl[i-3]-1<-0.05,
}
for H in (5,10):
    print(f"\n=== hold {H} days ===  split at {cut}")
    for name,fn in rules.items():
        res={0:[],1:[]}
        for s,c in D.items():
            cl=[x["close"] for x in c]; m20=ma(cl,20); m50=ma(cl,50); m200=ma(cl,200); r=rsi(cl)
            last=-99
            for i in range(60,len(c)-H-1):
                if not fn(i,c,cl,m20,m50,m200,r): continue
                if name!="baseline any-day" and i-last<H: continue
                last=i; e=c[i+1]["open"]; x=c[i+1+H]["close"]
                res[0 if c[i]["date"]<cut else 1].append((x/e-1)*100-C)
        def S(a):
            if not a: return "n=0"
            w=sum(v for v in a if v>0); l=-sum(v for v in a if v<0)
            return f"n={len(a):5d} avg {st.mean(a):+.2f}% win {100*sum(v>0 for v in a)/len(a):.0f}% PF {(w/l if l else 9):.2f}"
        print(f"{name:36s} TRAIN {S(res[0])} | TEST {S(res[1])}")
