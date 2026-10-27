import { useEffect, useState } from 'react';

export type ClockSample = { serverTime: string; receivedAt: number };

// Wall-clock edits on the device do not advance or rewind an auction countdown.
export function serverNow(sample: ClockSample, monotonicNow: number) {
  return Date.parse(sample.serverTime) + Math.max(0, monotonicNow - sample.receivedAt);
}

export function useServerClock(sample?: ClockSample) {
  const [tick, setTick] = useState(() => performance.now());

  useEffect(() => {
    const timer = window.setInterval(() => setTick(performance.now()), 250);

    return () => window.clearInterval(timer);
  }, []);

  return sample ? serverNow(sample, tick) : null;
}
