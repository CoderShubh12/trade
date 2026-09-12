"use client";

import { useState, useRef, useEffect } from "react";
import { STOCK_POOL } from "@/lib/stockPool";

export const MASTER_SYMBOLS = [
  {
    symbol: "SBIN",
    name: "STATE BANK OF INDIA",
    token: "3045",
    exchangeSegment: 1,
  },
  {
    symbol: "TATASTEEL",
    name: "TATA STEEL LTD",
    token: "3499",
    exchangeSegment: 1,
  },
  {
    symbol: "ITC",
    name: "ITC LTD",
    token: "1660",
    exchangeSegment: 1,
  },
  {
    symbol: "BEL",
    name: "BHARAT ELECTRONICS",
    token: "383",
    exchangeSegment: 1,
  },
  {
    symbol: "NIFTY 50",
    name: "NIFTY 50 INDEX",
    token: "99926000",
    exchangeSegment: 13,
  },
];

export default function StockSearch({ selectedSymbol, onSelectStock }) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState(MASTER_SYMBOLS);
  const [searching, setSearching] = useState(false);
  const dropdownRef = useRef(null);
  const debounceTimer = useRef(null);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults(MASTER_SYMBOLS);
      setSearching(false);
      return;
    }

    setSearching(true);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search-symbol?q=${encodeURIComponent(query)}`,
        );
        const json = await res.json();
        if (json.success && json.results && json.results.length > 0) {
          setResults(json.results);
        } else {
          // Fallback: लोकल STOCK_POOL (₹50–₹1,000) से फ़िल्टर करें
          const q = query.toLowerCase();
          const localMatched = (STOCK_POOL || [])
            .filter(
              (s) =>
                s.symbol.toLowerCase().includes(q) ||
                String(s.token).includes(q),
            )
            .slice(0, 10)
            .map((s) => ({
              symbol: s.symbol,
              name: s.symbol,
              token: String(s.token),
              exchangeSegment: s.segment || 1,
            }));
          setResults(localMatched);
        }
      } catch (e) {
        // नेटवर्क एरर पर लोकल पूल फॉलबैक
        const q = query.toLowerCase();
        const localMatched = (STOCK_POOL || [])
          .filter((s) => s.symbol.toLowerCase().includes(q))
          .slice(0, 10)
          .map((s) => ({
            symbol: s.symbol,
            name: s.symbol,
            token: String(s.token),
            exchangeSegment: s.segment || 1,
          }));
        setResults(localMatched);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(debounceTimer.current);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      ref={dropdownRef}
      style={{
        position: "relative",
        flex: "1 1 180px",
        maxWidth: "240px",
        minWidth: "140px",
      }}
    >
      <div
        style={{ position: "relative", display: "flex", alignItems: "center" }}
      >
        <input
          type="text"
          placeholder="Search ₹50–₹1k NSE..."
          value={isOpen ? query : selectedSymbol || ""}
          onFocus={() => {
            setQuery("");
            setIsOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          style={{
            width: "100%",
            background: "#0d131f",
            border: "1px solid #1f293d",
            borderRadius: "6px",
            color: "#fff",
            padding: "6px 28px 6px 10px",
            fontSize: "0.78rem",
            outline: "none",
          }}
        />
        <span
          style={{
            position: "absolute",
            right: "8px",
            color: "#555d6e",
            fontSize: "0.75rem",
            pointerEvents: "none",
          }}
        >
          {searching ? "⏳" : "🔍"}
        </span>
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "115%",
            left: 0,
            width: "280px",
            maxWidth: "90vw",
            maxHeight: "260px",
            overflowY: "auto",
            background: "#0c1017",
            border: "1px solid #1f293d",
            borderRadius: "6px",
            zIndex: 1000,
            boxShadow: "0 10px 30px rgba(0,0,0,0.7)",
          }}
        >
          {results.length === 0 ? (
            <div
              style={{
                padding: "10px 12px",
                color: "#717b90",
                fontSize: "0.75rem",
              }}
            >
              No stocks found for "{query}"
            </div>
          ) : (
            results.map((item) => (
              <div
                key={`${item.token}-${item.symbol}`}
                onClick={() => {
                  onSelectStock(item);
                  setIsOpen(false);
                }}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#151c2c")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <div>
                  <div
                    style={{
                      color: "#5B8CFF",
                      fontWeight: 700,
                      fontSize: "0.8rem",
                    }}
                  >
                    {item.symbol}
                  </div>
                  <div style={{ color: "#717b90", fontSize: "0.68rem" }}>
                    {item.name
                      ? item.name.slice(0, 22)
                      : `Token: ${item.token}`}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "0.62rem",
                    color: "#2FD98A",
                    background: "rgba(47,217,138,0.1)",
                    padding: "2px 5px",
                    borderRadius: "3px",
                    fontWeight: 600,
                  }}
                >
                  {item.exchangeSegment === 13 ? "INDEX" : "NSE EQ"}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// 🔑 Named export to prevent any import binding errors in page.jsx
export { StockSearch };
