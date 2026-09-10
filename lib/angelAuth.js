import axios from "axios";
import { authenticator } from "otplib";

// Use global to persist cached token across Next.js API re-evaluations
global.angelSession = global.angelSession || null;
global.angelTokenExpiry = global.angelTokenExpiry || 0;
global.angelLoginPromise = global.angelLoginPromise || null;

export async function getAngelSession() {
  const now = Date.now();

  if (global.angelSession && now < global.angelTokenExpiry) {
    return global.angelSession;
  }

  if (global.angelLoginPromise) {
    return global.angelLoginPromise;
  }

  global.angelLoginPromise = (async () => {
    try {
      const apiKey = process.env.ANGEL_API_KEY;
      const clientCode = process.env.ANGEL_CLIENT_CODE;
      const pin = process.env.ANGEL_PIN;
      const totpSecret = process.env.ANGEL_TOTP_SECRET;

      if (!apiKey || !clientCode || !pin || !totpSecret) {
        throw new Error("Angel credentials missing in .env.local");
      }

      const totp = authenticator.generate(totpSecret);

      const res = await axios.post(
        "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
        { clientcode: clientCode, password: pin, totp },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "fe80::1",
            "X-PrivateKey": apiKey,
          },
          timeout: 8000,
        },
      );

      if (!res.data?.status || !res.data?.data?.jwtToken) {
        throw new Error(res.data?.message || "Login failed");
      }

      global.angelSession = {
        jwtToken: res.data.data.jwtToken,
        feedToken: res.data.data.feedToken,
        clientCode,
        apiKey,
      };

      global.angelTokenExpiry = Date.now() + 8 * 60 * 60 * 1000;
      return global.angelSession;
    } finally {
      global.angelLoginPromise = null;
    }
  })();

  return global.angelLoginPromise;
}
