'use client';

import { useEffect, useState } from 'react';

export default function SessionStatus() {
  const [state, setState] = useState({ isOpen: false, label: 'Checking NSE session…' });

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hourCycle: 'h23',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    const openMinutes = 9 * 60 + 15;
    const closeMinutes = 15 * 60 + 30;

    function update() {
      const parts = formatter.formatToParts(new Date());
      const map = {};
      for (const p of parts) map[p.type] = p.value;

      const currentMinutes = parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10);
      const isWeekday = !['Sat', 'Sun'].includes(map.weekday);
      const isOpen = isWeekday && currentMinutes >= openMinutes && currentMinutes < closeMinutes;

      setState({
        isOpen,
        label: `NSE ${isOpen ? 'LIVE' : 'CLOSED'} · ${map.hour}:${map.minute} IST`,
      });
    }

    update();
    const timerId = setInterval(update, 15000);
    return () => clearInterval(timerId);
  }, []);

  return (
    <span className="session-status">
      <span className={`session-dot ${state.isOpen ? 'open' : 'closed'}`} />
      <span>{state.label}</span>
    </span>
  );
}