"use client";

import { useState, useRef, useEffect } from "react";

export const MASTER_SYMBOLS = [
  {
    symbol: "NIFTY 50",
    name: "NIFTY 50 INDEX",
    token: "26000",
    exchangeSegment: 1,
  },
  {
    symbol: "BANK NIFTY",
    name: "BANK NIFTY INDEX",
    token: "26009",
    exchangeSegment: 1,
  },
  {
    symbol: "RELIANCE",
    name: "RELIANCE-EQ",
    token: "2885",
    exchangeSegment: 1,
  },
  {
    symbol: "HDFCBANK",
    name: "HDFCBANK-EQ",
    token: "1333",
    exchangeSegment: 1,
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
        if (json.success && json.results) {
          setResults(json.results);
        }
      } catch (e) {
        console.error("Search fetch error:", e);
      } finally {
        setSearching(false);
      }
    }, 250);

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
    <div ref={dropdownRef} style={{ position: "relative", width: "230px" }}>
      <div
        style={{ position: "relative", display: "flex", alignItems: "center" }}
      >
        <input
          type="text"
          placeholder="Search any NSE stock..."
          value={isOpen ? query : selectedSymbol}
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
            padding: "7px 32px 7px 10px",
            fontSize: "0.8rem",
            outline: "none",
          }}
        />
        <span
          style={{
            position: "absolute",
            right: "10px",
            color: "#555d6e",
            fontSize: "0.8rem",
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
            width: "300px",
            maxHeight: "280px",
            overflowY: "auto",
            background: "#0c1017",
            border: "1px solid #1f293d",
            borderRadius: "6px",
            zIndex: 1000,
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
          }}
        >
          {results.length === 0 ? (
            <div
              style={{ padding: "12px", color: "#717b90", fontSize: "0.78rem" }}
            >
              No NSE stocks found for "{query}"
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
                  padding: "9px 12px",
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
                      fontWeight: 600,
                      fontSize: "0.82rem",
                    }}
                  >
                    {item.symbol}
                  </div>
                  <div style={{ color: "#717b90", fontSize: "0.7rem" }}>
                    Token: {item.token}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "0.65rem",
                    color: "#2FD98A",
                    background: "rgba(47,217,138,0.1)",
                    padding: "2px 5px",
                    borderRadius: "3px",
                  }}
                >
                  NSE EQ
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
