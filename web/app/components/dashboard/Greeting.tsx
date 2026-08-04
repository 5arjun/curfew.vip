"use client";

import { useSyncExternalStore } from "react";

// Time-aware greeting (D14): text only — no buttons, no date, nothing beside
// it. The day-part comes from the DJ's clock, so it's computed client-side;
// the server render guesses from its own clock and the client corrects on
// hydration (suppressHydrationWarning absorbs the possible mismatch). The
// small-hours band (before 5am) reads as "evening" — for a DJ, 3am is still
// the night, not the morning.
function dayPart(hour: number): "morning" | "afternoon" | "evening" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

function useLocalDayPart(): "morning" | "afternoon" | "evening" {
  return useSyncExternalStore(
    () => () => {},
    () => dayPart(new Date().getHours()),
    () => "evening",
  );
}

export function Greeting({ name }: { name: string | null }) {
  const part = useLocalDayPart();
  return (
    <h1 className="dz-greeting" suppressHydrationWarning>
      Good {part}
      {name ? `, ${name}` : ""}
    </h1>
  );
}
