// Combo Rules: cross-question logic, "trust but verify."
//
// STATUS: data only, not wired up. Nothing in the app currently
// evaluates these. The source Excel workbook already has real,
// worked-out logic here (its Combo Rules tab), so rather than invent
// placeholders, these are transcribed from that tab (in our own words,
// structured so code can evaluate them, not copied verbatim) as real
// starting content.
//
// When this gets activated: after scoring, check each rule's conditions
// against the tier (see lib/scoring.ts -> tierForRating) of the relevant
// answers, and surface any rule whose conditions are all met alongside
// the per-question Action Library entries.

import type { Tier } from "./questions";

export interface RuleCondition {
  questionId: string;
  tiers: Tier[]; // condition is met if the answer's tier is one of these
}

export interface ComboRule {
  id: string;
  conditions: RuleCondition[]; // all conditions must be met (AND)
  situation: string;
  recommendedAction: string;
}

const POOR_FAIR: Tier[] = ["Poor", "Fair"];
const GOOD_EXCELLENT: Tier[] = ["Good", "Excellent"];

export const COMBO_RULES: ComboRule[] = [
  {
    id: "R1",
    conditions: [
      { questionId: "W1", tiers: GOOD_EXCELLENT },
      { questionId: "W3", tiers: POOR_FAIR },
    ],
    situation: "The owner trusts their valuation, but the exit timeline is short or unclear.",
    recommendedAction: "Trust but verify: confirm the valuation is current before anything else gets planned around it. An unclear runway means the number needs to be right, soon.",
  },
  {
    id: "R2",
    conditions: [
      { questionId: "W1", tiers: GOOD_EXCELLENT },
      { questionId: "W3", tiers: GOOD_EXCELLENT },
    ],
    situation: "Credible valuation and a clear, comfortable timeline.",
    recommendedAction: "Use the current valuation as a working number and shift effort to closing the wealth gap and de-risking the business. Revisit the valuation annually rather than re-commissioning it.",
  },
  {
    id: "R3",
    conditions: [
      { questionId: "W2", tiers: POOR_FAIR },
      { questionId: "W3", tiers: GOOD_EXCELLENT },
    ],
    situation: "The owner knows roughly when they want out, but not how much they need.",
    recommendedAction: "Run the wealth-gap analysis first. A timeline without a target number is a countdown to an undefined destination.",
  },
  {
    id: "R4",
    conditions: [
      { questionId: "W6", tiers: POOR_FAIR },
      { questionId: "W3", tiers: POOR_FAIR },
    ],
    situation: "Retirement depends entirely on the sale, and there's no timeline yet.",
    recommendedAction: "This is the highest-urgency wealth conversation on the list. Coordinate with the client's wealth advisor on outside savings and get a working timeline on paper.",
  },
  {
    id: "R5",
    conditions: [
      { questionId: "A3", tiers: POOR_FAIR },
      { questionId: "W3", tiers: GOOD_EXCELLENT },
    ],
    situation: "A clear (possibly near) timeline, but financials can't be produced quickly.",
    recommendedAction: "Financial cleanup is on the critical path. Start standardizing the three-year financial package now. It takes months, and every deal will ask for it.",
  },
  {
    id: "R6",
    conditions: [
      { questionId: "A4", tiers: POOR_FAIR },
      { questionId: "V2", tiers: POOR_FAIR },
    ],
    situation: "Everything routes through the owner, and there's no trusted deal confidant on staff.",
    recommendedAction: "A transaction would stall on day one. Position the advisory firm as the confidential outside deal team, and start delegating operational duties in parallel.",
  },
  {
    id: "R7",
    conditions: [
      { questionId: "V1", tiers: POOR_FAIR },
      { questionId: "V7", tiers: GOOD_EXCELLENT },
    ],
    situation: "Revenue is concentrated in a few customers, but it reliably repeats.",
    recommendedAction: "The concentration discount is partly offset by that stickiness. Get the top accounts under contract, then diversify from a position of strength.",
  },
  {
    id: "R8",
    conditions: [
      { questionId: "V2", tiers: GOOD_EXCELLENT },
      { questionId: "V3", tiers: POOR_FAIR },
    ],
    situation: "The owner says the business runs fine without them, but the management bench looks thin.",
    recommendedAction: "These answers are in tension, worth a direct follow-up. Either the owner is underrating their team, or the business depends on them more than they realize.",
  },
  {
    id: "R9",
    conditions: [
      { questionId: "E6", tiers: GOOD_EXCELLENT },
      { questionId: "E1", tiers: POOR_FAIR },
    ],
    situation: "The owner believes they know why margins lag, but hasn't actually benchmarked against real data.",
    recommendedAction: "Verify before accepting the explanation. Without a benchmark, the 'why' is a theory. Run the industry comparison and test it against the data.",
  },
  {
    id: "R10",
    conditions: [
      { questionId: "E3", tiers: GOOD_EXCELLENT },
      { questionId: "E2", tiers: POOR_FAIR },
    ],
    situation: "Pricing gets reviewed regularly, but without job-level or customer-level profitability data.",
    recommendedAction: "The pricing review may be resting on incomplete inputs. Build job-level profitability reporting first, then re-run the pricing review on top of it.",
  },
];
