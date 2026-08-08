import { describe, expect, it } from "vitest";
import { unidentifiableTracksDisclosure, type LibraryRosterEntry } from "./libraryRoster";

describe("unidentifiableTracksDisclosure (Story 4.11 AC-6)", () => {
  it("returns null when nothing was excluded", () => {
    expect(unidentifiableTracksDisclosure(0, 930)).toBeNull();
  });

  it("returns null when the total is zero (nothing to rate against)", () => {
    expect(unidentifiableTracksDisclosure(5, 0)).toBeNull();
  });

  it("returns null when the exclusion rate is below the materiality bar", () => {
    // 3/930 is well under 5%.
    expect(unidentifiableTracksDisclosure(3, 930)).toBeNull();
  });

  it("discloses a material exclusion rate, matching Arjun's real measured library (252/910 audio rows, 27.7%)", () => {
    const disclosure = unidentifiableTracksDisclosure(252, 910);
    expect(disclosure).not.toBeNull();
    expect(disclosure).toContain("252");
    expect(disclosure).toContain("missing a title or artist tag");
  });

  it("states whole-library scope so it cannot read as an addition to the windowed meter", () => {
    // Story 4.11 code review: this line renders under a conversion meter whose
    // denominator is 38 at the 60-day default and 0 at 30 days. The old copy
    // ("N more tracks ... aren't counted here at all") read as an increment on
    // that figure. The scope must be explicit and the word "more" must be gone.
    const disclosure = unidentifiableTracksDisclosure(252, 910) ?? "";
    expect(disclosure).toContain("Across your whole library");
    expect(disclosure).not.toContain("more");
    expect(disclosure).not.toContain("here at all");
  });

  it("uses singular phrasing for exactly one excluded track", () => {
    // 1/10 clears the 5% bar (10%) so the singular branch is reachable.
    const disclosure = unidentifiableTracksDisclosure(1, 10);
    expect(disclosure).toBe(
      "Across your whole library, 1 track is missing a title or artist tag — without both, " +
        "it can't be identified, so it isn't counted in any of these figures.",
    );
  });

  it("uses plural phrasing for more than one excluded track", () => {
    const disclosure = unidentifiableTracksDisclosure(252, 910);
    expect(disclosure).toContain("252 tracks are missing");
    expect(disclosure).toContain("they can't be identified");
    expect(disclosure).toContain("they aren't counted in any of these figures");
  });

  it("never fabricates a caveat from a negative count", () => {
    expect(unidentifiableTracksDisclosure(-1, 930)).toBeNull();
  });
});

describe("LibraryRosterEntry shape (Story 4.11 AC-1/AC-3/AC-4/AC-5)", () => {
  it("round-trips a baseline entry with null title/artist/added_at (a pathological but legal case)", () => {
    const entry: LibraryRosterEntry = {
      track_id: "a1b2c3d4e5f60718",
      title: null,
      artist: null,
      added_at: null,
      is_baseline: true,
      absent_at: null,
    };
    expect(entry.is_baseline).toBe(true);
    expect(entry.absent_at).toBeNull();
  });

  it("round-trips an absent, previously go-forward entry", () => {
    const entry: LibraryRosterEntry = {
      track_id: "0718a1b2c3d4e5f6",
      title: "Track A",
      artist: "Artist A",
      added_at: "2026-03-01T00:00:00.000Z",
      is_baseline: false,
      absent_at: "2026-04-01T00:00:00.000Z",
    };
    expect(entry.absent_at).not.toBeNull();
    expect(entry.is_baseline).toBe(false);
  });
});
