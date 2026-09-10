export function parseBinaryPacket(buffer) {
  try {
    const view = new DataView(buffer);
    const subscriptionMode = view.getUint8(0);
    const exchangeType = view.getUint8(1);

    let tokenStr = '';
    for (let i = 2; i < 27; i++) {
      const charCode = view.getUint8(i);
      if (charCode === 0) break;
      tokenStr += String.fromCharCode(charCode);
    }

    const sequenceNumber = view.getBigInt64(27, true);
    const exchangeTimestamp = view.getBigInt64(35, true);
    const ltpPaise = view.getBigInt64(43, true);
    const ltp = Number(ltpPaise) / 100;

    return {
      token: tokenStr.trim(),
      exchangeType,
      subscriptionMode,
      ltp,
      timestamp: Number(exchangeTimestamp),
    };
  } catch (e) {
    return null;
  }
}