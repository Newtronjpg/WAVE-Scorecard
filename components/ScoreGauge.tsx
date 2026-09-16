import { READINESS_BANDS, bandFor } from "@/lib/scoring";
import { BAND_COLORS, clampScore, needleAngleFor } from "@/lib/gauge";

// A 180-degree four-band speedometer for the overall readiness score.
//
// The needle angle is continuous, not snapped to the band it lands in, so two
// scores inside the same band still read differently -- 74 sits visibly right
// of 65 even though both are "Good". That is the entire reason this replaced
// the numeral: a band label alone flattens a 25-point range into one word.
//
// Deliberately carries no numeric readout.
//
// Three things about the composition, all of them fixes to how the first
// version actually rendered rather than preferences:
//
//   The dial states its own band, under the hub. A 180-degree gauge is a
//   half-disc with an empty lower half, and the band word was previously a
//   separate pill sitting below the whole SVG -- which left that space empty
//   AND said "Good" twice within an inch. Putting the word where the space
//   already was fixes both, and the needle never sweeps below the hub, so
//   nothing can collide with it.
//
//   The needle is a slim taper, not a wedge. At the size this renders, a
//   9-unit base plus a 6-unit hub merged into one black blob heavy enough to
//   be the first thing the eye landed on -- ahead of the colour and the word.
//
//   Segments are capped round and separated by a wider gap, which reads as
//   four steps on a scale rather than one poured gradient.

const CENTER_X = 100;
const CENTER_Y = 100;
const RADIUS = 80;
const TRACK_WIDTH = 12;

// Band labels sit just outside the track. Inside it they clip: near the ends
// of the arc the band runs nearly vertical, so a horizontal word overflows the
// track's thickness and the overflow lands on the paper background.
const LABEL_RADIUS = RADIUS + 15;

// Degrees dropped between segments so the colour boundaries read as four
// distinct bands. Wider than it needs to be for separation alone -- at this
// scale a hairline gap disappears and the arc looks continuous again.
const SEGMENT_GAP = 2.4;

// Angles use the needle's convention: -90 is the left end of the arc, 0 is
// straight up, +90 is the right end.
function polar(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER_X + radius * Math.sin(rad),
    y: CENTER_Y - radius * Math.cos(rad),
  };
}

function arcPath(startAngle: number, endAngle: number, radius: number) {
  const start = polar(startAngle, radius);
  const end = polar(endAngle, radius);
  // Every segment is 45 degrees, so large-arc is always 0. Sweep is 1 because
  // left-to-right over the top is clockwise in SVG's y-down space.
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
}

const SEGMENT_SPAN = 180 / READINESS_BANDS.length;

const SEGMENTS = READINESS_BANDS.map((band, i) => {
  const start = -90 + i * SEGMENT_SPAN;
  const end = start + SEGMENT_SPAN;
  const mid = start + SEGMENT_SPAN / 2;
  return {
    label: band.label,
    color: BAND_COLORS[i],
    // The gap is inset on both sides so the four segments stay centred on
    // their true 45-degree slices.
    path: arcPath(start + SEGMENT_GAP, end - SEGMENT_GAP, RADIUS),
    labelPos: polar(mid, LABEL_RADIUS),
    // Centring every label would push the outer two back over the arc: near
    // the ends the dial is widest horizontally, so the first and last labels
    // get anchored outward and sit clear of it instead.
    anchor: (mid < -45 ? "end" : mid > 45 ? "start" : "middle") as
      | "start"
      | "middle"
      | "end",
  };
});

const NEEDLE_TIP = RADIUS - 13;
const NEEDLE_BASE = 2.6;

export function ScoreGauge({
  score,
  label = "Overall readiness",
}: {
  score: number;
  label?: string;
}) {
  const safeScore = clampScore(score);
  const angle = needleAngleFor(safeScore);
  const activeBand = bandFor(safeScore);
  const activeColor = BAND_COLORS[READINESS_BANDS.indexOf(activeBand)];

  return (
    <svg
      viewBox="-26 4 252 134"
      // Scales fluidly with whatever column it sits in and stays centred. The
      // cap stops the dial from dominating the page on wide viewports; the
      // viewBox aspect ratio handles the height on its own.
      className="block w-full max-w-[400px] h-auto mx-auto"
      role="img"
      aria-label={`${label}: ${activeBand.label}`}
    >
      <g aria-hidden="true">
        {SEGMENTS.map((seg) => (
          <path
            key={seg.label}
            d={seg.path}
            fill="none"
            stroke={seg.color}
            strokeWidth={TRACK_WIDTH}
            strokeLinecap="round"
            // The band the score landed in carries full weight; the other
            // three stay legible but recede, so the eye finds the answer
            // before it reads the scale.
            opacity={seg.label === activeBand.label ? 1 : 0.32}
          />
        ))}

        {SEGMENTS.map((seg) => (
          <text
            key={seg.label}
            x={seg.labelPos.x}
            y={seg.labelPos.y}
            textAnchor={seg.anchor}
            dominantBaseline="central"
            // Uniformly quiet. The active band is already carried by the
            // full-strength segment, the needle and the word under the hub;
            // a fourth emphasis here just made the same point again.
            fill="var(--color-ink-muted)"
            fontSize="9.5"
            fontWeight={500}
            style={{ fontFamily: "var(--font-sans)", letterSpacing: "0.08em" }}
          >
            {seg.label.toUpperCase()}
          </text>
        ))}

        {/* The needle rotates about the hub. Its transition is intentionally
            the only motion here, and the global prefers-reduced-motion rule in
            app/globals.css cancels it with !important for anyone who has asked
            for less movement. */}
        <g
          style={{
            transform: `rotate(${angle}deg)`,
            transformOrigin: `${CENTER_X}px ${CENTER_Y}px`,
            transition: "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <polygon
            points={`${CENTER_X - NEEDLE_BASE},${CENTER_Y} ${CENTER_X},${CENTER_Y - NEEDLE_TIP} ${CENTER_X + NEEDLE_BASE},${CENTER_Y}`}
            fill="var(--color-ink)"
          />
        </g>
        <circle cx={CENTER_X} cy={CENTER_Y} r="4" fill="var(--color-ink)" />

        {/* The reading, in the empty half the dial leaves behind. */}
        <text
          x={CENTER_X}
          y={CENTER_Y + 26}
          textAnchor="middle"
          dominantBaseline="central"
          fill={activeColor}
          fontSize="22"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {activeBand.label}
        </text>
      </g>
    </svg>
  );
}
