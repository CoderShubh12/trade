// app/api/auth/login/route.js
import { NextResponse } from "next/server";

const USERS = {
  admin: { password: "adminPassword123", role: "ADMIN" },
  Aditya1802: { password: "Rana1802", role: "TESTER" }, // 👈 यहाँ पासवर्ड "Rana1802" और रोल "TESTER" कर दिया है
};

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    const user = USERS[username];
    if (!user || user.password !== password) {
      return NextResponse.json(
        { success: false, error: "अमान्य यूज़रनेम या पासवर्ड!" },
        { status: 401 },
      );
    }

    const response = NextResponse.json({ success: true, role: user.role });
    response.cookies.set({
      name: "terminal_session",
      value: JSON.stringify({ username, role: user.role }),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "सर्वर एरर" },
      { status: 500 },
    );
  }
}
