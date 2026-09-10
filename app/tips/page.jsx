'use client';

import Link from 'next/link';

export default function TipsPlaybookPage() {
  const tips = [
    {
      category: 'TIMEFRAME MASTERY',
      color: '#5B8CFF',
      items: [
        {
          title: 'The 15m - 5m Golden Rule',
          desc: 'Never fight the 15-minute trend. If 15m is below VWAP & EMA 21, reject all 5m BUY signals. Trade only in the direction of the higher timeframe.',
        },
        {
          title: 'First 15-Minute Rule (9:15 - 9:30 AM)',
          desc: 'Never trade market orders in the first 15 minutes. Institutions absorb retail emotional orders here. Wait for the 30-min Opening Range (ORB) to form.',
        },
        {
          title: 'Precise 3m Entry Refinement',
          desc: 'Spot the breakout on 5m, but enter on 3m when price pulls back to retest the broken level or EMA 9. This cuts your Stop Loss risk by nearly half.',
        },
      ],
    },
    {
      category: 'VWAP & CPR INSTITUTIONAL SECRETS',
      color: '#c084fc',
      items: [
        {
          title: 'VWAP Magnet & Extension Trap',
          desc: 'When price stretches more than 2x ATR above VWAP, do not chase BUY orders. Price will either snap back to VWAP like a rubber band or chop sideways.',
        },
        {
          title: 'Virgin / Narrow CPR Days',
          desc: 'When CPR band is extremely narrow, prepare for a sharp one-directional trending day. Wide CPR indicates a range-bound, mean-reverting chop day.',
        },
        {
          title: 'Central Pivot Acceptance',
          desc: 'Price opening above Central Pivot and staying above Top Central (TC) confirms institutional accumulation. Every dip to TC is a high-probability bounce zone.',
        },
      ],
    },
    {
      category: 'VOLUME & LIQUIDITY TRAPS',
      color: '#2FD98A',
      items: [
        {
          title: 'Low Volume Breakout = Trap',
          desc: 'If a candle breaks the day high/low without volume crossing the 20-SMA orange line, it is 80% likely a fake breakout designed to hunt retail stop losses.',
        },
        {
          title: 'Climax Volume Exhaustion',
          desc: 'An unusually giant volume bar (3x–5x above average) after a long rally often marks the top, not the continuation. Smart money is dumping into retail FOMO.',
        },
        {
          title: 'Liquidity Sweeps (Wicks)',
          desc: 'If price spikes past swing highs, triggers retail stops, and instantly closes back inside the range with a long wick, enter immediately in the opposite direction.',
        },
      ],
    },
    {
      category: 'CAPITAL & RISK DEFENSE',
      color: '#FF5D5D',
      items: [
        {
          title: 'Hard 1:2.5 Risk-to-Reward Only',
          desc: 'If Target 1 does not offer at least 1.5x your ATR risk, skip the trade. Taking low RR trades will slowly drain your capital through slippage and brokerage.',
        },
        {
          title: 'Breakeven Rule at Target 1',
          desc: 'The moment price touches Target 1, immediately move your Hard Stop Loss to entry price (Breakeven). Never allow a winning trade to turn into a red loss.',
        },
        {
          title: 'Daily Max Drawdown Circuit',
          desc: 'If you take 2 consecutive losses in a session, close the terminal. Overtrading in revenge mode guarantees account blowups.',
        },
      ],
    },
  ];

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#070a10',
        color: '#e2e8f0',
        padding: '24px 32px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #161f30',
          paddingBottom: '16px',
          marginBottom: '28px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.2rem', color: '#5B8CFF' }}>✦</span>
            <h1
              style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: 800,
                letterSpacing: '0.05em',
                color: '#fff',
              }}
            >
              INSTITUTIONAL PLAYBOOK & INTRADAY CHEAT SHEET
            </h1>
          </div>
          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '0.8rem' }}>
            Core execution rules, algorithmic setups, and smart-money trap avoidance guidelines.
          </p>
        </div>

        <Link
          href="/"
          style={{
            background: '#151d2c',
            color: '#5B8CFF',
            border: '1px solid #223048',
            padding: '8px 16px',
            borderRadius: '6px',
            textDecoration: 'none',
            fontSize: '0.82rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          ← Back to Live Terminal
        </Link>
      </header>

      {/* Grid of Categories */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px',
        }}
      >
        {tips.map((section) => (
          <div
            key={section.category}
            style={{
              background: '#0c1017',
              border: '1px solid #161f30',
              borderRadius: '10px',
              padding: '20px',
            }}
          >
            <div
              style={{
                fontSize: '0.78rem',
                fontWeight: 800,
                color: section.color,
                letterSpacing: '0.06em',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: section.color,
                }}
              />
              {section.category}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {section.items.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.04)',
                    padding: '12px 14px',
                    borderRadius: '6px',
                  }}
                >
                  <div
                    style={{
                      color: '#fff',
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      marginBottom: '4px',
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    style={{
                      color: '#8b93a3',
                      fontSize: '0.78rem',
                      lineHeight: '1.55',
                    }}
                  >
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}