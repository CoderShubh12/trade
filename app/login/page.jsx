// app/login/page.jsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (data.success) {
        router.push("/");
        router.refresh();
      } else {
        setError(data.error || "लॉगिन असफल रहा");
      }
    } catch (e) {
      setError("कनेक्शन त्रुटि हुई");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "#0a0e17",
      }}
    >
      <div
        style={{
          background: "#0f172a",
          padding: "30px",
          borderRadius: "10px",
          border: "1px solid #334155",
          width: "100%",
          maxWidth: "380px",
        }}
      >
        <h1
          style={{
            color: "#38bdf8",
            fontSize: "1.2rem",
            marginBottom: "20px",
            textAlign: "center",
          }}
        >
          🔒 TERMINAL ACCESS CONTROL
        </h1>

        {error && (
          <div
            style={{
              background: "rgba(255,93,93,0.1)",
              color: "#FF5D5D",
              padding: "8px",
              borderRadius: "4px",
              fontSize: "0.78rem",
              marginBottom: "14px",
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleLogin}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <div>
            <label
              style={{
                fontSize: "0.75rem",
                color: "#94a3b8",
                display: "block",
                marginBottom: "4px",
              }}
            >
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin या tester"
              required
              style={{
                width: "100%",
                background: "#020617",
                border: "1px solid #334155",
                color: "#fff",
                padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "0.85rem",
                outline: "none",
              }}
            />
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                color: "#94a3b8",
                display: "block",
                marginBottom: "4px",
              }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: "100%",
                background: "#020617",
                border: "1px solid #334155",
                color: "#fff",
                padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "0.85rem",
                outline: "none",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "10px",
              background: "#0284c7",
              color: "#fff",
              border: "none",
              padding: "10px",
              borderRadius: "6px",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            {loading ? "Logging in..." : "Authenticate Terminal"}
          </button>
        </form>
      </div>
    </main>
  );
}
