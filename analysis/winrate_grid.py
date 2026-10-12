# Win-rate vs money: long entry at 10:15 open (no signal on purpose), target/stop grid, full costs, 42 stocks x 63 days.
import json,glob,os,numpy as np
SL=0.0003; NOT=100000
def costs(q,b,s):
    bt,st=q*b,q*s; br=min(20,0.0003*bt)+min(20,0.0003*st)
    ex=0.0000345*(bt+st); stt=0.00025*st; stamp=0.00003*bt; gst=0.18*(br+ex)
    return br+ex+stt+stamp+gst
days=[]
for f in glob.glob('data/movers/5m/*_5m.json'):
    n=os.path.basename(f)
    if n.startswith(('NIFTY','BANK_NIFTY')): continue
    c=json.load(open(f))['candles']; d={}
    for k in c: d.setdefault(k['date'],[]).append(k)
    for v in d.values():
        i=[j for j,b in enumerate(v) if b['clock']=='10:15']; e=[j for j,b in enumerate(v) if b['clock']=='15:10']
        if i and e and v[i[0]]['volume']>0: days.append(v[i[0]:e[0]+1])
print('trades',len(days))
print('target% stop%  win%   net/trade   PF')
for tgt in (0.003,0.005,0.01):
  for stp in (0.005,0.01,0.02,0.03):
    pn=[]
    for v in days:
        en=v[0]['open']*(1+SL); T=en*(1+tgt); S=en*(1-stp); ex=None
        for b in v:
            if b['low']<=S: ex=S;break      # pessimistic: stop first
            if b['high']>=T: ex=T;break
        if ex is None: ex=v[-1]['close']
        ex*=1-SL; q=int(NOT/en); pn.append((ex-en)*q-costs(q,en,ex))
    pn=np.array(pn); w=pn[pn>0].sum(); l=-pn[pn<=0].sum()
    print(f'{tgt*100:5.1f} {stp*100:5.1f} {100*(pn>0).mean():6.1f} {pn.mean():10.0f} {w/l:6.2f}')
