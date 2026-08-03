import Link from "next/link";
import { describeSet } from "@/lib/sets/describe";
import type { SetRecord } from "@/lib/sets";
import { HeroEnergyArc } from "./HeroEnergyArc";
import { HeroLiquidDisc } from "./HeroLiquidDisc";

// The feature hero (Story 3.6 redesign) — one large set, treated like the cover
// of the night. A server component: the editorial copy + the arc are pure, and
// the only client island is the liquid-metal disc. Identity is built entirely
// from REAL data via describeSet (date, session, dancefloor narrative, dominant
// genre, peak BPM) — there is no venue in the data, so none is invented.
//
// Composition: an editorial column (eyebrow → headline → dek → stat strip → CTA)
// beside the cold-chrome disc, with the glowing energy arc spanning the full
// width beneath both as the hero visual. A static atmosphere glow + a legibility
// scrim keep the display type readable where it crosses the arc.
export function Hero({ set }: { set: SetRecord }) {
  const desc = describeSet(set);

  return (
    <section className="hero" aria-labelledby="hero-headline">
      <div className="hero-atmos" aria-hidden="true" />

      <div className="hero-top">
        <div className="hero-editorial">
          <p className="hero-eyebrow text-label-sm">{desc.eyebrow}</p>
          <h2 id="hero-headline" className="text-display-xl hero-headline">
            {desc.headline}
          </h2>
          <p className="hero-dek text-body-lg">{desc.dek}</p>

          <dl className="hero-stats">
            {desc.stats.map((stat) => (
              <div className="hero-stat" key={stat.label}>
                <dt className="text-label-sm hero-stat-label">{stat.label}</dt>
                <dd className="hero-stat-value">{stat.value}</dd>
              </div>
            ))}
          </dl>

          <Link
            href={`/set/${set.external_id}`}
            className="hero-cta"
            aria-label={`Read the night — ${desc.eyebrow}`}
          >
            <span>Read the night</span>
            <span aria-hidden="true" className="hero-cta-arrow">
              →
            </span>
          </Link>
        </div>

        <HeroLiquidDisc className="hero-disc-slot" />
      </div>

      <div className="hero-arc-wrap">
        <HeroEnergyArc
          points={set.derived.energy_arc}
          segment={desc.segment}
          dancefloor={desc.dancefloor}
          doorsLabel={desc.doorsLabel}
          lastCallLabel={desc.lastCallLabel}
        />
      </div>
    </section>
  );
}
