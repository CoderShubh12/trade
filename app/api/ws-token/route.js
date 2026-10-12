// app/api/ws-token/route.js
// DISABLED on purpose. The app polls candles on the server and no browser code uses the
// WebSocket, so the Angel One feed token must never be sent to the browser.
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ success: false, error: "Disabled: broker tokens stay on the server." }, { status: 410 });
}
