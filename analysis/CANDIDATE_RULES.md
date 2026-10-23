# Candidate rules (NOT validated)

CANDIDATES ONLY - NOT VALIDATED. None passed the rule (test PF>=1.3, n>=100, train>0, both test halves>0). All were negative on the train half, so they look regime-dependent. Do NOT use live; forward paper-test first.

| Rule | Mode | SL/TP (ATR) | Train n / PF / net% | Test n / PF / net% | Test halves net% |
|---|---|---|---|---|---|
| sp_M | FOLLOW | 1.5/3 | 580 / 0.8 / -21.57 | 254 / 1.35 / 15.75 | 6.38 , 9.37 |
| sp_LOD | FOLLOW | 1.5/2 | 368 / 0.66 / -24.93 | 174 / 1.31 / 8.47 | 2.43 , 6.04 |
| sp_LOD | FOLLOW | 1.5/3 | 368 / 0.67 / -27.02 | 174 / 1.29 / 9.46 | 4.34 , 5.12 |
| sp_W? | FADE | 1.5/3 | 1884 / 0.81 / -79.26 | 817 / 1.19 / 33.68 | 7.85 , 25.83 |
| sp_M | FOLLOW | 1/3 | 580 / 0.7 / -29.18 | 254 / 1.19 / 7.85 | 1.94 , 5.91 |
| sp_M | FOLLOW | 0.75/3 | 580 / 0.66 / -29.77 | 254 / 1.12 / 4.38 | -0.36 , 4.75 |
| sp_W? | FADE | 1/3 | 1884 / 0.76 / -89.34 | 817 / 1.11 / 16.96 | 0.92 , 16.03 |
| sp_LOD | FOLLOW | 1.5/1.5 | 368 / 0.62 / -24.67 | 174 / 1.11 / 2.89 | 0.09 , 2.81 |
| sp_M? | FOLLOW | 1/3 | 1826 / 0.77 / -81.36 | 795 / 1.1 / 15.99 | 3.59 , 12.4 |
| sp_M | FOLLOW | 1.5/2 | 580 / 0.84 / -15.62 | 254 / 1.1 / 3.98 | 2.92 , 1.06 |

Rule notes: sp_* = lib/signalPoints.js rules (W/M double bottom/top neckline break, ORB, VWAP+EMA cross, HOD/LOD on volume). Promotion rule: forward paper data must show PF >= 1.3, >= 100 trades, positive net on both halves.
