// The FAQ's content, lifted out of FaqBeats.tsx (launch checklist §1.5) so it
// can be read from BOTH sides of the client boundary. FaqBeats is a "use
// client" module; importing a plain value out of one into a server component
// yields a client reference, not the data — so /faq's FAQPage JSON-LD could
// not have been built from the same array that renders the page. It now is,
// which is the point: Google's structured-data policy requires the marked-up
// answer to be the answer on the page, and the only durable way to guarantee
// that is to have one array rather than two.
//
// No "use client" directive here on purpose — a plain data module is usable
// from either side.

export type Q = { id: string; q: string; a: string[] };
export type Section = { id: string; title: string; qs: Q[] };

export const SECTIONS: Section[] = [
  {
    id: "the-basics",
    title: "The basics",
    qs: [
      {
        id: "who-is-curfew-for",
        q: "Who is Curfew for?",
        a: [
          "Working DJs who play real rooms in Serato: clubs, weddings, corporate nights, private events, bars, radio. If you finish a set wondering how the night actually went, Curfew is built for you.",
          "It fits wedding and private-event DJs especially well: long nights where cocktail hour, dinner and the real dancefloor blur together are exactly what Curfew was built to pull apart.",
        ],
      },
      {
        id: "what-is-curfew",
        q: "What is Curfew?",
        a: [
          "Curfew is an archive of your DJ sets that builds itself. It connects to Serato through a small desktop app called the Curfew agent, and every night you play shows up on your dashboard: the full tracklist in order against the clock, the arc of the night, and how the set sits against the nights before it.",
          "You never file anything, upload anything, or press record. You play; the archive keeps.",
        ],
      },
      {
        id: "what-do-i-need",
        q: "What do I need to use it?",
        a: [
          "Two things: Serato DJ on a Mac or Windows laptop, and the Curfew agent installed on that laptop. No hardware, no plugin inside Serato, nothing to export.",
          "If you play on other software such as Rekordbox, Traktor or Engine DJ, Curfew cannot read your sets yet. Serato is what it speaks today.",
        ],
      },
      {
        id: "change-how-i-play",
        q: "Do I have to change how I play?",
        a: [
          "No. Curfew picks the night up on its own once the set ends. Nothing runs inside Serato, nothing touches your decks, and there is no button to remember mid-set.",
        ],
      },
      {
        id: "old-sets",
        q: "Will my old sets show up, or only new ones?",
        a: [
          "Your archive starts the day you join. Curfew files every set you play from then on; nights from before Curfew are not imported.",
          "The value compounds from night one. After a month you can already see a month of your own history moving.",
        ],
      },
    ],
  },
  {
    id: "your-sets",
    title: "Your sets",
    qs: [
      {
        id: "where-data-comes-from",
        q: "Where does the data come from?",
        a: [
          "From Serato, and from the tags already on the tracks in your library: artist, title, BPM, key, genre. When a set ends, Curfew has the night: what you played, in what order, at what time.",
          "Curfew never listens to audio and never needs the music files themselves.",
        ],
      },
      {
        id: "dancefloor-detection",
        q: "What is the dancefloor detection engine?",
        a: [
          "A night is longer than its dancefloor. If you play weddings or private events you know the shape: cocktail hour, dinner, speeches, and then the part everyone came for. Club nights have their own version: the empty first hour, the pack-down.",
          "The dancefloor detection engine finds the stretch that actually mattered and draws that window on the set, so your stats are measured on the real dancefloor, not on the dinner hour.",
        ],
      },
      {
        id: "dancefloor-wrong",
        q: "What if the engine gets the dancefloor wrong?",
        a: [
          "Drag the edges. Your correction stands, the night’s stats recalculate against it, and the engine learns from what you fixed for next time. It is an estimate you can always overrule, never a verdict.",
        ],
      },
      {
        id: "no-internet",
        q: "What happens if I play somewhere with no internet?",
        a: [
          "The set is captured on your laptop the moment it ends, and syncs on its own when you are back online. Nothing about a night is lost to a bad connection.",
        ],
      },
    ],
  },
  {
    id: "your-data",
    title: "Your data",
    qs: [
      {
        id: "music-files-uploaded",
        q: "Do my music files get uploaded?",
        a: [
          "No. Your music and your library never leave your laptop.",
          "What syncs is the record of the set: track titles, times, keys, BPMs, and the stats built from them. Nothing else.",
        ],
      },
      {
        id: "who-can-see-sets",
        q: "Who can see my sets?",
        a: [
          "You. Sets are private to your account. There are no public profiles, no feed, and no leaderboard putting your nights in front of anyone else.",
        ],
      },
      {
        id: "export-or-delete",
        q: "Can I get my data out, or delete everything?",
        a: [
          "Yes, both, on request. Ask, and your archive comes back to you in a portable format; ask, and Curfew deletes the account and every row of data it owns. The agent’s own local database lives on your laptop and goes with the app.",
          "A self-serve control is coming. Until then a request is handled by a person, not a queue.",
        ],
      },
    ],
  },
  {
    id: "the-agent",
    title: "The agent",
    qs: [
      {
        id: "what-is-the-agent",
        q: "What exactly is the agent?",
        a: [
          "A small app that sits in your menu bar on macOS, or the system tray on Windows. It keeps your archive up to date on its own and stays out of the way. Builds are signed, and it updates itself.",
        ],
      },
      {
        id: "slow-serato-down",
        q: "Does it run during my set, or slow Serato down?",
        a: [
          "It never attaches to Serato and never touches audio. Its work happens after the night, not during it. While you play, it stays out of the way.",
        ],
      },
      {
        id: "usb-library",
        q: "My library lives on a USB drive. Does that work?",
        a: [
          "Yes. Tell the agent where your library lives and it works from there. If the drive is unplugged the agent says so plainly, and picks up where it left off when the drive comes back.",
        ],
      },
    ],
  },
  {
    id: "the-plan",
    title: "The plan",
    qs: [
      {
        id: "what-does-it-cost",
        q: "What does Curfew cost?",
        a: [
          "One plan: $6.99 a month billed yearly, or $7.99 month to month. Every feature is in it. There are no tiers, and nothing sits behind a higher price.",
        ],
      },
      {
        id: "why-paid",
        q: "Why is Curfew paid?",
        a: [
          "The subscription keeps the archive running: it covers database, server and hosting costs, plus the engineering and support behind the agent and the site.",
        ],
      },
      {
        id: "what-if-i-cancel",
        q: "What happens if I cancel?",
        a: [
          "You stop paying. No lock-in, no wind-down call. Your data stays yours either way: export or deletion, on request, exactly as above.",
        ],
      },
    ],
  },
];
