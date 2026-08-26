// The WAVE Scorecard factory question bank -- the shipped default and
// fallback, not the runtime source of truth (see lib/questionContent.ts).
// Every question defines its own 5-point rubric: each rating is a
// specific, concrete state of the business, not a point on a generic
// agreement scale.
//
//   1 -> Poor      2 -> Fair      3 -> Good      4-5 -> Excellent
//
// `label` is the short anchor shown on/under each rating button.
// `description` is the full sentence shown once a rating is selected.

export type Gap = "wealth" | "accounting" | "value" | "earnings";
export type Tier = "Poor" | "Fair" | "Good" | "Excellent";

export interface RatingLevel {
  value: number; // 1..levels.length, contiguous
  tier: Tier;
  label: string;
  description: string;
}

export interface Question {
  id: string;
  gap: Gap;
  statement: string;
  levels: RatingLevel[];
}

export interface GapMeta {
  id: Gap;
  name: string;
  tagline: string;
  description: string;
}

export const GAPS: GapMeta[] = [
  {
    id: "wealth",
    name: "Wealth gap",
    tagline: "Do you know your number?",
    description: "What your business is worth vs. what you need it to be worth.",
  },
  {
    id: "accounting",
    name: "Accounting gap",
    tagline: "Could your finance team survive a deal?",
    description: "Whether your accounting/finance team is positioned to handle a transaction.",
  },
  {
    id: "value",
    name: "Value gap",
    tagline: "What will a buyer discount?",
    description: "The risks a buyer will find, and discount you for.",
  },
  {
    id: "earnings",
    name: "Earnings gap",
    tagline: "How do you stack up against your industry?",
    description: "How your profitability stacks up against your industry.",
  },
];

function tierFor(value: 1 | 2 | 3 | 4 | 5): Tier {
  if (value === 1) return "Poor";
  if (value === 2) return "Fair";
  if (value === 3) return "Good";
  return "Excellent";
}

function levels(
  labels: [string, string, string, string, string],
  descriptions: [string, string, string, string, string]
): RatingLevel[] {
  return [1, 2, 3, 4, 5].map((v) => ({
    value: v as 1 | 2 | 3 | 4 | 5,
    tier: tierFor(v as 1 | 2 | 3 | 4 | 5),
    label: labels[v - 1],
    description: descriptions[v - 1],
  }));
}

export const QUESTIONS: Question[] = [
  // Wealth
  {
    id: "W1",
    gap: "wealth",
    statement:
      "I know what my business is worth today, based on a credible recent valuation, not a guess or a rule of thumb.",
    levels: levels(
      ["Never valued", "Rule-of-thumb guess", "Informal opinion of value", "Formal valuation, dated", "Current credentialed valuation"],
      [
        "I have never had the business valued. My number is a guess or an industry rule of thumb I heard somewhere.",
        "I have a rough sense from an online calculator or a rule of thumb, but never had anyone actually look at my numbers.",
        "I got an informal opinion of value from my CPA or a broker, but it wasn't a formal valuation.",
        "I have a formal valuation, but it's more than two years old or wasn't done by a credentialed valuation professional.",
        "I have a credentialed valuation completed within the last two years, and I understand what's driving the number.",
      ]
    ),
  },
  {
    id: "W2",
    gap: "wealth",
    statement: "I know the specific dollar amount I need to walk away with to fund my retirement or next chapter.",
    levels: levels(
      ["No number at all", "Rough ballpark only", "Estimated, not tested", "Calculated with an advisor", "Verified against sale proceeds"],
      [
        "I haven't calculated a number. I'd know it when I saw it.",
        "I have a rough ballpark in my head, but haven't run the actual numbers.",
        "I've estimated a number based on my spending and savings, but haven't stress-tested it.",
        "I've calculated a number with a financial advisor, factoring in retirement income and expenses.",
        "I have a specific, advisor-verified number, and I know how it compares to my likely sale proceeds.",
      ]
    ),
  },
  {
    id: "W3",
    gap: "wealth",
    statement: "I have a clear timeline for when I'd like to step back or transition out of the business.",
    levels: levels(
      ["No timeline", "Someday, not sure when", "Target year, unshared", "Discussed, not documented", "Written, known by advisors"],
      [
        "No timeline. I haven't thought about when.",
        "I have a general sense (\"sometime in the next several years\") but no target date.",
        "I have a target year in mind, but haven't written it down or shared it with anyone.",
        "I have a target date I've discussed with my advisors, though it isn't formally documented.",
        "I have a written target date that my advisory team knows and is actively planning around.",
      ]
    ),
  },
  {
    id: "W4",
    gap: "wealth",
    statement: "My CPA, attorney, and wealth advisor all know my plans, and they talk to each other.",
    levels: levels(
      ["Advisors don't know", "Only one advisor knows", "Each knows, don't talk", "Mostly aligned, inconsistent", "Fully aligned team"],
      [
        "My advisors don't know I'm thinking about this, or I don't have this full team in place.",
        "One advisor knows generally, but the others are not aware or not engaged.",
        "Each advisor individually knows my plans, but they've never talked to each other about it.",
        "Most of my advisors are aware and occasionally coordinate, but it isn't consistent.",
        "My CPA, attorney, and wealth advisor are all aligned and actively coordinate on my behalf.",
      ]
    ),
  },
  {
    id: "W5",
    gap: "wealth",
    statement: "I understand roughly how much of a sale price I'd actually keep after taxes, debt payoff, and fees.",
    levels: levels(
      ["Haven't thought about it", "Know it's owed, not how much", "Rough guess only", "Estimated with my CPA", "Detailed net-proceeds estimate"],
      [
        "I haven't thought about this. I assume I'd keep most of the sale price.",
        "I know I'll owe taxes and pay off debt, but haven't estimated how much.",
        "I have a rough guess at my net proceeds, but haven't run real numbers.",
        "I've estimated net proceeds with my CPA, though it wasn't a deep analysis.",
        "I have a detailed net-proceeds estimate covering taxes, debt payoff, and transaction fees.",
      ]
    ),
  },
  {
    id: "W6",
    gap: "wealth",
    statement: "I have meaningful savings outside the business, my retirement doesn't depend entirely on selling it.",
    levels: levels(
      ["Net worth is the business", "Some savings, not enough", "A cushion, sale still essential", "Sale accelerates, doesn't enable", "Sale would be a bonus"],
      [
        "Nearly all my net worth is tied up in the business. A sale is the plan.",
        "I have some outside savings, but nowhere near enough to retire on without a sale.",
        "I have a meaningful cushion outside the business, but a sale is still essential to my plan.",
        "I have substantial outside savings, and a sale would meaningfully accelerate my plans, not make them.",
        "My retirement doesn't depend on selling the business at all. A sale would be a bonus, not a requirement.",
      ]
    ),
  },
  {
    id: "W7",
    gap: "wealth",
    statement: "I have a written plan for how and when I'll hand off or sell the business.",
    levels: levels(
      ["No exit plan", "An idea, not written", "Written, not reviewed", "Written and reviewed", "Written, reviewed annually"],
      [
        "No exit plan. Nothing written down, nothing discussed with anyone.",
        "A rough idea in my head, but nothing written and no advisor conversations yet.",
        "Written down and mentioned to at least one advisor, but not formally reviewed.",
        "Written and reviewed with my advisory team, though not on a set schedule.",
        "Written, advisor-reviewed, and revisited at least once a year.",
      ]
    ),
  },

  // Accounting
  {
    id: "A1",
    gap: "accounting",
    statement: "Our monthly financial statements are accurate and finished within 15 days of month-end.",
    levels: levels(
      ["45+ days, unreliable", "30-45 days, inconsistent", "20-30 days, accurate", "Within 15 days, mostly", "15 days, every month"],
      [
        "We're often more than 45 days behind, or the numbers aren't reliable when we do close.",
        "We usually close within 30 to 45 days, and accuracy is inconsistent.",
        "We close within 20 to 30 days and the numbers are generally accurate.",
        "We close within 15 days most months, with only occasional exceptions.",
        "We close within 15 days every month, without exception, and the numbers are accurate.",
      ]
    ),
  },
  {
    id: "A2",
    gap: "accounting",
    statement: "Someone on my team can build a forecast or projection, not just record what already happened.",
    levels: levels(
      ["No one can", "Only I can", "Attempted, basic", "Regular, informal process", "Reliable and maintained"],
      [
        "No one on my team can build a forward-looking projection.",
        "I could build one myself, but nobody on staff can.",
        "Someone on staff has attempted a projection, but it's basic or infrequent.",
        "Someone on my team regularly builds projections, though the process is informal.",
        "Someone on my team builds and maintains a reliable, regularly updated projection.",
      ]
    ),
  },
  {
    id: "A3",
    gap: "accounting",
    statement: "If a buyer asked tomorrow, we could hand over three years of clean, consistent financials within two weeks.",
    levels: levels(
      ["Months, and shaky", "A month of cleanup first", "2-4 weeks, some cleanup", "About two weeks", "Two weeks, today"],
      [
        "It would take months, and I'm not confident what we'd hand over would hold up.",
        "It would take a month or more of cleanup work first.",
        "It would take two to four weeks, with some cleanup needed.",
        "We could do it in about two weeks, with minor gaps to explain.",
        "We could hand over three years of clean, consistent financials within two weeks, today.",
      ]
    ),
  },
  {
    id: "A4",
    gap: "accounting",
    statement: "I have someone financially capable I trust to work on a confidential deal without alarming the rest of the staff.",
    levels: levels(
      ["No one", "Capable, not discreet", "Discreet, capability unclear", "Capable and discreet, untested", "Proven on real deals"],
      [
        "No one. I'd have to handle it myself or bring someone in from outside cold.",
        "I have someone capable, but I'm not confident they could keep it confidential.",
        "I have someone I'd trust with confidentiality, but I'm not sure about their financial capability for a deal.",
        "I have someone who's both capable and discreet, though they haven't been tested on a real deal.",
        "I have someone financially capable and proven discreet who could run point on a confidential deal today.",
      ]
    ),
  },
  {
    id: "A5",
    gap: "accounting",
    statement: "We set a budget every year and actually compare our results against it during the year.",
    levels: levels(
      ["No formal budget", "Set, never revisited", "Checked occasionally", "Reviewed most months", "Reviewed monthly, drives decisions"],
      [
        "We don't set a formal budget.",
        "We set a budget but rarely, if ever, look back at it.",
        "We set a budget and check it occasionally, but not on a regular schedule.",
        "We set a budget and review actual-versus-budget most months.",
        "We set a budget and review actual-versus-budget every month, and it shapes decisions.",
      ]
    ),
  },
  {
    id: "A6",
    gap: "accounting",
    statement: "The way we record revenue and job costs would hold up if an outside expert dug into it.",
    levels: levels(
      ["Wouldn't hold up", "Known soft spots", "Revenue solid, costing thin", "Solid, minor gaps", "Documented and defensible"],
      [
        "I'm not confident our revenue or job costing would hold up to real scrutiny.",
        "Some of it would hold up, but I know there are soft spots.",
        "Revenue recognition is solid, but job-level or customer-level costing is thin or inconsistent.",
        "Both are generally solid, with only minor documentation gaps.",
        "I'm confident both would hold up to a detailed outside review, and it's documented.",
      ]
    ),
  },
  {
    id: "A7",
    gap: "accounting",
    statement: "Our books are in good enough shape that an audit or review wouldn't scare me.",
    levels: levels(
      ["Would be stressful", "Would be a scramble", "Doable, findings likely", "Reasonably good shape", "Would welcome it"],
      [
        "An audit or review would be stressful and would likely turn up real problems.",
        "It would be a scramble, and I'm not confident what they'd find.",
        "We'd get through it, but it would take real effort and some findings are likely.",
        "We'd be in reasonably good shape, with only minor items to clean up.",
        "I'd welcome an audit or review today. I'm confident in what they'd find.",
      ]
    ),
  },

  // Value
  {
    id: "V1",
    gap: "value",
    statement: "No single customer makes up more than 20% of my revenue.",
    levels: levels(
      ["One customer, 50%+", "Top customer 30-50%", "Top customer 20-30%", "Near 20%, diversifying", "Genuinely diversified"],
      [
        "One customer is 50% or more of my revenue.",
        "My top customer is between 30% and 50% of revenue.",
        "My top customer is between 20% and 30% of revenue.",
        "My top customer is close to 20%, and I'm actively working to diversify further.",
        "No single customer is above 20% of revenue, and my base is genuinely diversified.",
      ]
    ),
  },
  {
    id: "V2",
    gap: "value",
    statement: "The business could run for a month without me and nothing important would break.",
    levels: levels(
      ["Struggles within days", "A week or two", "Most of a month", "Close to a month", "A full month, no issue"],
      [
        "The business would struggle within days without me.",
        "We'd survive a week or two, but real problems would surface fast.",
        "We could manage most of a month, with some things slipping.",
        "We could run close to a month smoothly, with only minor issues.",
        "The business could run a full month without me and nothing important would break.",
      ]
    ),
  },
  {
    id: "V3",
    gap: "value",
    statement: "I have managers a buyer would want to keep, and who would likely stay after a sale.",
    levels: levels(
      ["No real managers", "Managers, not essential", "Valuable, unsure they'd stay", "Solid, likely to stay", "Strong team, confident they'd stay"],
      [
        "I don't have real managers. Most things run through me.",
        "I have some managers, but I doubt a buyer would see them as essential.",
        "I have a few managers a buyer would value, but I'm not confident they'd stay through a transition.",
        "I have solid managers a buyer would want to keep, and most would likely stay.",
        "I have a strong management team a buyer would want to retain, and I'm confident they'd stay.",
      ]
    ),
  },
  {
    id: "V4",
    gap: "value",
    statement: "Our key processes, contracts, and customer relationships are written down, not just in my head.",
    levels: levels(
      ["Lives in my head", "A little documented", "Processes yes, relationships no", "Mostly documented", "Fully documented"],
      [
        "Almost everything important lives in my head, not on paper.",
        "A few things are documented, but most of the critical knowledge is still mine alone.",
        "Core processes are documented, but contracts and relationship details are not.",
        "Most of it is documented, with a few important gaps.",
        "Processes, contracts, and key relationships are all documented and accessible without me.",
      ]
    ),
  },
  {
    id: "V5",
    gap: "value",
    statement: "Losing one supplier, vendor, or key piece of equipment wouldn't put us in serious trouble.",
    levels: levels(
      ["Would be a crisis", "Serious disruption", "Hurts, but recoverable", "Backups, few exceptions", "Not seriously exposed"],
      [
        "Losing one key supplier or piece of equipment would be a real crisis for us.",
        "It would cause serious disruption and cost us real money and time.",
        "It would hurt, but we'd recover within a reasonable amount of time.",
        "We have backups in most cases, with a couple of exceptions.",
        "We're not seriously exposed to any single supplier, vendor, or piece of equipment.",
      ]
    ),
  },
  {
    id: "V6",
    gap: "value",
    statement: "My personal finances and business finances are cleanly separated.",
    levels: levels(
      ["Significantly intertwined", "Meaningful overlap", "Mostly separated", "Cleanly separated, minor items", "Fully, cleanly separated"],
      [
        "They're significantly intertwined. Untangling them would be a real project.",
        "There's meaningful overlap that would need real cleanup.",
        "Mostly separated, but a few things would need to be sorted out.",
        "Cleanly separated, with only minor items (a shared card or two) to note.",
        "Fully and cleanly separated. A buyer's diligence team would find nothing to untangle.",
      ]
    ),
  },
  {
    id: "V7",
    gap: "value",
    statement: "A big share of our revenue repeats every year, we don't start from zero each January.",
    levels: levels(
      ["Start from zero", "Small share repeats", "About half repeats", "Clear majority repeats", "Reliably repeats"],
      [
        "We essentially start from zero every year. Very little revenue is guaranteed to repeat.",
        "A small share repeats. Most of the year is new business we have to win.",
        "Roughly half of our revenue repeats in some form year to year.",
        "A clear majority of our revenue repeats, with some new business needed to grow.",
        "The large majority of our revenue reliably repeats year over year.",
      ]
    ),
  },

  // Earnings
  {
    id: "E1",
    gap: "earnings",
    statement: "I know how my profit margins compare to other companies in my industry.",
    levels: levels(
      ["No idea", "Vague sense only", "Looked at it once", "Check periodically", "Actively tracked"],
      [
        "I have no idea how my margins compare to my industry.",
        "I have a vague sense, but nothing based on real data.",
        "I've looked at industry benchmarks once or occasionally, informally.",
        "I check industry benchmarks periodically and generally know where I stand.",
        "I actively track my margins against real industry benchmarks and know exactly where I stand.",
      ]
    ),
  },
  {
    id: "E2",
    gap: "earnings",
    statement: "I know which jobs, products, or customers make me the most money, and which ones lose money.",
    levels: levels(
      ["Don't break it down", "Rough sense only", "Looked at it once", "Tracked, some gaps", "Tracked continuously"],
      [
        "I don't break this down. I only look at overall profitability.",
        "I have a rough sense, but nothing based on real numbers.",
        "I've looked at this once or twice, but don't track it regularly.",
        "I track this fairly regularly, though the data has some gaps.",
        "I know exactly which jobs, products, or customers make and lose money, and I track it continuously.",
      ]
    ),
  },
  {
    id: "E3",
    gap: "earnings",
    statement: "We review our pricing at least once a year against what things actually cost us.",
    levels: levels(
      ["Rarely revisited", "Adjusted, not cost-based", "Roughly annual, informal", "Annual, minor gaps", "Annual, real cost data"],
      [
        "We rarely, if ever, revisit pricing based on actual costs.",
        "We adjust pricing occasionally, but not based on a real cost review.",
        "We review pricing roughly annually, though the process is informal.",
        "We review pricing annually against real cost data, with minor gaps.",
        "We review pricing at least annually against actual, current cost data.",
      ]
    ),
  },
  {
    id: "E4",
    gap: "earnings",
    statement: "My cash flow is predictable, I'm rarely surprised by a cash crunch.",
    levels: levels(
      ["Frequent surprises", "Fairly often surprised", "Mostly steady", "Predictable, rare surprises", "Genuinely predictable"],
      [
        "Cash surprises happen often and put real stress on the business.",
        "Cash flow is unpredictable enough that surprises happen fairly regularly.",
        "Cash flow is mostly steady, but I get caught off guard occasionally.",
        "Cash flow is predictable most of the time, with rare surprises.",
        "Cash flow is genuinely predictable. Surprises are rare to nonexistent.",
      ]
    ),
  },
  {
    id: "E5",
    gap: "earnings",
    statement: "We track a handful of key numbers every month and change how we operate based on them.",
    levels: levels(
      ["Go by feel", "Rarely changes anything", "Most months, sometimes acted on", "Monthly, generally acted on", "Monthly, actively drives ops"],
      [
        "I don't track specific numbers regularly. I mostly go by feel.",
        "I look at some numbers occasionally, but they rarely change how we operate.",
        "I track a few key numbers most months, and they sometimes influence decisions.",
        "I track key numbers every month and they generally inform decisions.",
        "I track a clear set of key numbers every month, and they actively drive how we operate.",
      ]
    ),
  },
  {
    id: "E6",
    gap: "earnings",
    statement: "If my margins are below average for my industry, I know exactly why.",
    levels: levels(
      ["Wouldn't know where to start", "A guess, unverified", "Some sense, unverified", "Generally know the drivers", "Backed by real data"],
      [
        "I wouldn't know where to start explaining a margin gap.",
        "I'd have a guess, but nothing I could back up with data.",
        "I have some sense of the drivers, but haven't verified it with real analysis.",
        "I generally know the drivers and could explain most of the gap.",
        "I could explain exactly why, backed by real data on costs, pricing, and mix.",
      ]
    ),
  },
  {
    id: "E7",
    gap: "earnings",
    statement: "We have a real process for controlling costs, not just keeping an eye on things.",
    levels: levels(
      ["No real process", "Loose eye, no process", "Informal, inconsistent", "Defined, mostly followed", "Defined, consistently followed"],
      [
        "We don't have a real cost control process. We react when something looks off.",
        "We keep a loose eye on costs, but there's no defined process.",
        "We have an informal process that catches some things, but it's inconsistent.",
        "We have a defined cost control process that we mostly follow.",
        "We have a defined, consistently followed process for controlling costs.",
      ]
    ),
  },
];

export function questionsByGap(gap: Gap): Question[] {
  return QUESTIONS.filter((q) => q.gap === gap);
}

export function getQuestion(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}
