// server.js के अंदर

// 1. सेंट्रल ट्रेड लाइफसाइकिल मेमोरी मैप
// Format: { [token]: { symbol, side, entry, vwap, target1, sl, startTime, maxTime } }
const activeTrades = {};

// 2. जब Angel One से बाइनरी टिक डिकोड होकर आए
function processTickAndLifecycle(tick) {
  const token = tick.token;
  const currentPrice = tick.ltp;
  const trade = activeTrades[token];

  // ========================================================
  // A. अगर इस स्टॉक पर पहले से ट्रेड चल रहा है (LOCKED)
  // ========================================================
  if (trade) {
    const isBuyVwapBreach = trade.side === "BUY" && currentPrice < trade.vwap;
    const isSellVwapBreach = trade.side === "SELL" && currentPrice > trade.vwap;
    const isTargetHit =
      (trade.side === "BUY" && currentPrice >= trade.target1) ||
      (trade.side === "SELL" && currentPrice <= trade.target1);
    const isSlHit =
      (trade.side === "BUY" && currentPrice <= trade.sl) ||
      (trade.side === "SELL" && currentPrice >= trade.sl);
    const isTimeExpired = Date.now() > trade.maxTime; // 20-25 मिनट स्टैग्नेशन

    // 🚨 1. VWAP ब्रेक या स्टॉप-लॉस -> तुरंत एग्जिट ब्रॉडकास्ट
    if (isBuyVwapBreach || isSellVwapBreach || isSlHit || isTimeExpired) {
      io.emit("trade_alert", {
        type: isTimeExpired ? "TIME_EXPIRED" : "EXIT_NOW",
        token,
        symbol: trade.symbol,
        exitPrice: currentPrice,
        reason: isTimeExpired
          ? "20 Min Stagnation Timeout"
          : "Session VWAP Breached",
      });

      // 🔓 स्टॉक अनलॉक (मेमोरी से डिलीट)
      delete activeTrades[token];
      return;
    }

    // 🎯 2. टारगेट हिट
    if (isTargetHit) {
      io.emit("trade_alert", {
        type: "TARGET_HIT",
        token,
        symbol: trade.symbol,
        exitPrice: currentPrice,
      });

      // 🔓 स्टॉक अनलॉक
      delete activeTrades[token];
      return;
    }

    // ट्रेड अभी सुरक्षित चल रहा है -> कोई डुप्लीकेट कॉल ब्रॉडकास्ट नहीं होगी
    return;
  }

  // ========================================================
  // B. अगर स्टॉक पर कोई ट्रेड नहीं है (UNLOCKED / FRESH SETUP)
  // ========================================================
  // यहाँ 5M कैंडल क्लोज पर टेक्निकल स्कोर चेक होता है
  const score = getTechnicalScore(token); // +65 या -65
  const vwap = getSessionVwap(token);
  const atr = getAtr(token);

  if (score >= 65) {
    // 🔒 नया ट्रेड लॉक रजिस्टर करें
    activeTrades[token] = {
      symbol: getSymbolFromToken(token),
      side: "BUY",
      entry: currentPrice,
      vwap: vwap,
      sl: currentPrice - 1.5 * atr,
      target1: currentPrice + 2.0 * atr,
      startTime: Date.now(),
      maxTime: Date.now() + 25 * 60 * 1000, // 25 मिनट लॉक
    };

    // 📢 सभी कनेक्टेड यूज़र्स को एक साथ ब्रॉडकास्ट
    io.emit("trade_alert", {
      type: "BUY",
      token,
      symbol: activeTrades[token].symbol,
      price: currentPrice,
      levels: activeTrades[token],
    });
  }
}
