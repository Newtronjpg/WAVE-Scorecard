// Action Library: one recommended action per question, for when that
// question scores Poor or Fair.
//
// STATUS: data only, not wired up. Nothing in the app currently reads
// this file. It exists so that turning on the recommendations engine is
// an additive change (build the trigger logic + a review step, point it
// at this file) instead of a rewrite.
//
// Every entry below is `status: "draft"`, on purpose, the same way the
// source workbook labels its auto-recommendations: "these are drafts to
// react to." Nothing here should reach a client until an advisor at the
// firm has actually reviewed and edited it.
// Treat this as a fast first pass, not a finished library.

import type { Gap } from "./questions";

export interface ActionLibraryEntry {
  questionId: string;
  gap: Gap;
  action: string;
  status: "draft" | "confirmed";
}

export const ACTION_LIBRARY: ActionLibraryEntry[] = [
  { questionId: "W1", gap: "wealth", status: "draft", action: "Get a credentialed valuation on the calendar now. Nothing else about the wealth gap can be sized accurately without a real number." },
  { questionId: "W2", gap: "wealth", status: "draft", action: "Work with a wealth advisor to size the actual retirement number needed, then compare it against the likely business value." },
  { questionId: "W3", gap: "wealth", status: "draft", action: "Pin down a target year, even a rough one, then build the plan backward from it annually." },
  { questionId: "W4", gap: "wealth", status: "draft", action: "Build the advisor contact list and get the CPA, attorney, and wealth advisor into the same conversation." },
  { questionId: "W5", gap: "wealth", status: "draft", action: "Run the net-proceeds math (taxes, debt payoff, fees) so the target number is a real take-home figure, not a headline price." },
  { questionId: "W6", gap: "wealth", status: "draft", action: "Flag this for the wealth advisor. Reduced dependence on the sale changes both negotiating posture and timeline pressure." },
  { questionId: "W7", gap: "wealth", status: "draft", action: "Get the exit plan on paper and put an annual review of it on the calendar." },

  { questionId: "A1", gap: "accounting", status: "draft", action: "Diagnose what's slowing the monthly close (staffing, systems, or process) and fix the biggest bottleneck first." },
  { questionId: "A2", gap: "accounting", status: "draft", action: "Either train someone internally or bring in fractional help to build a basic forecasting habit." },
  { questionId: "A3", gap: "accounting", status: "draft", action: "Start standardizing the three-year financial package now. Every deal will ask for it eventually." },
  { questionId: "A4", gap: "accounting", status: "draft", action: "Identify who could run point on a confidential deal, or flag that no one currently can, before a real deal forces the question." },
  { questionId: "A5", gap: "accounting", status: "draft", action: "Stand up a simple budget-to-actual review as a monthly habit rather than a once-a-year exercise." },
  { questionId: "A6", gap: "accounting", status: "draft", action: "Start with job-level or customer-level costing. That's usually the weakest link under real outside scrutiny." },
  { questionId: "A7", gap: "accounting", status: "draft", action: "Run a mock internal review now, on your own terms, before a buyer's diligence team runs it on theirs." },

  { questionId: "V1", gap: "value", status: "draft", action: "Get the largest account(s) under contract, then actively work to diversify from a position of strength." },
  { questionId: "V2", gap: "value", status: "draft", action: "Start delegating the operational duties that currently require the owner personally, one at a time." },
  { questionId: "V3", gap: "value", status: "draft", action: "Identify the one or two roles most critical to retain, and start building retention incentives around them." },
  { questionId: "V4", gap: "value", status: "draft", action: "Prioritize documenting whatever currently exists only in the owner's head first. Everything else is easier to reconstruct later." },
  { questionId: "V5", gap: "value", status: "draft", action: "Map the single points of failure (suppliers, vendors, equipment) and line up a real backup for the riskiest one." },
  { questionId: "V6", gap: "value", status: "draft", action: "Clean up personal and business finance overlap now. It's one of the first things diligence will flag." },
  { questionId: "V7", gap: "value", status: "draft", action: "Look for ways to convert one-time or project revenue into contracts, subscriptions, or retainers." },

  { questionId: "E1", gap: "earnings", status: "draft", action: "Run a real industry margin comparison. Owners are frequently surprised by where they actually stand." },
  { questionId: "E2", gap: "earnings", status: "draft", action: "Build job-level or customer-level profitability reporting before making pricing or staffing calls on gut feel." },
  { questionId: "E3", gap: "earnings", status: "draft", action: "Put an annual pricing-versus-cost review on the calendar. Costs move even when prices don't." },
  { questionId: "E4", gap: "earnings", status: "draft", action: "Build a rolling cash flow forecast. Most 'surprises' are visible weeks in advance to anyone looking." },
  { questionId: "E5", gap: "earnings", status: "draft", action: "Pick three to five numbers that actually drive decisions and review them monthly. No more, no fewer." },
  { questionId: "E6", gap: "earnings", status: "draft", action: "Benchmark first, then test the explanation for any margin gap against real data instead of assuming it." },
  { questionId: "E7", gap: "earnings", status: "draft", action: "Formalize whatever informal cost-checking already happens into a repeatable monthly process." },
];

export function actionFor(questionId: string): ActionLibraryEntry | undefined {
  return ACTION_LIBRARY.find((a) => a.questionId === questionId);
}
