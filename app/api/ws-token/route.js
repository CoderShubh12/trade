import { NextResponse } from "next/server";
import { getAngelSession } from "@/lib/angelAuth"; // या जहाँ आपका सेशन जनरेट होता है

export async function GET() {
  try {
    const session = await getAngelSession(); // सर्वर पर जनरेटेड सेशन

    if (!session || !session.feedToken) {
      return NextResponse.json(
        { success: false, error: "Session unavailable" },
        { status: 401 },
      );
    }

    // केवल feedToken और public clientCode भेजें — API Key कभी नहीं!
    return NextResponse.json({
      success: true,
      data: {
        feedToken: session.feedToken,
        clientCode: process.env.ANGEL_CLIENT_CODE,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 },
    );
  }
}
