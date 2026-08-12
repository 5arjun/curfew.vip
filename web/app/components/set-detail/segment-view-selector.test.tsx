import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SegmentViewSelector } from "./SegmentViewSelector";
import type { DancefloorSegment } from "@/lib/sets/dancefloor";

/**
 * RENDER ASSERTIONS for the view-scope selector (Story 5.4, Task 2.4).
 *
 * Same house rules as `segment-editor-threading.test.tsx`: string assertions
 * over rendered markup, no React Testing Library, no jsdom.
 */

function seg(id: string, overrides: Partial<DancefloorSegment> = {}): DancefloorSegment {
  return {
    id,
    firstPlayId: `first-${id}`,
    lastPlayId: `last-${id}`,
    confirmed: true,
    start: "2026-06-21T23:00:00.000Z",
    end: "2026-06-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("the view-scope selector (Task 2.4, AC #1/#2)", () => {
  it("renders NOTHING for a 0-segment set — the negative control", () => {
    const html = renderToStaticMarkup(
      <SegmentViewSelector segments={[]} selectedId={null} onSelect={() => undefined} />,
    );
    expect(html).toBe("");
  });

  it("renders NOTHING for a 1-segment set — no picker clutter for the common case", () => {
    const html = renderToStaticMarkup(
      <SegmentViewSelector segments={[seg("a")]} selectedId="a" onSelect={() => undefined} />,
    );
    expect(html).toBe("");
  });

  it("renders one chip per segment for a 2+-segment set, labelled by rank", () => {
    const html = renderToStaticMarkup(
      <SegmentViewSelector
        segments={[seg("a"), seg("b"), seg("c")]}
        selectedId="a"
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain("Dancefloor 1");
    expect(html).toContain("Dancefloor 2");
    expect(html).toContain("Dancefloor 3");
  });

  it("marks exactly the selected chip, so the scoped segment is never ambiguous", () => {
    const html = renderToStaticMarkup(
      <SegmentViewSelector
        segments={[seg("a"), seg("b")]}
        selectedId="b"
        onSelect={() => undefined}
      />,
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
  });
});
