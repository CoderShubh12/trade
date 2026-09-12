// lib/angelStream.js

export function parseBinaryPacket(buffer) {
  try {
    if (!buffer || buffer.byteLength < 31) return null;

    const view = new DataView(buffer);
    const subscriptionMode = view.getUint8(0);
    const exchangeType = view.getUint8(1);

    // Token: 25 bytes ASCII (Bytes 2 to 26)
    let tokenStr = "";
    for (let i = 2; i < 27; i++) {
      const charCode = view.getUint8(i);
      if (charCode === 0) break;
      tokenStr += String.fromCharCode(charCode);
    }
    const token = tokenStr.trim();

    let ltp = 0;
    let volume = 0;
    const timestamp = Date.now();

    // Mode 1 & 2 LTP Offset (Bytes 43 to 46 - 4 bytes int32 little-endian)
    if (view.byteLength >= 47) {
      const ltpPaise = view.getInt32(43, true);
      ltp = ltpPaise / 100;
    }

    // Mode 2 (Quote Mode) Data
    if (subscriptionMode === 2 && view.byteLength >= 55) {
      const lastTradedQty = view.getInt32(47, true);
      const avgTradedPrice = view.getInt32(51, true) / 100;
      volume = view.byteLength >= 63 ? Number(view.getBigInt64(55, true)) : 0;

      return {
        token,
        exchangeType,
        subscriptionMode,
        ltp,
        volume,
        lastTradedQty,
        avgTradedPrice,
        timestamp,
      };
    }

    return {
      token,
      exchangeType,
      subscriptionMode,
      ltp,
      timestamp,
    };
  } catch (e) {
    console.error("Binary Packet Parse Error:", e);
    return null;
  }
}
