import {
  FIRM_ADDRESS,
  FIRM_NAME,
  FIRM_PHONE,
  FIRM_SITE,
  FW_LOCKUP,
} from "@/lib/brand";

// Letterhead for the printed results, modelled on the brand guide's own page
// furniture: lockup and a rule at the head, a rule and the firm's details at
// the foot.
//
// This is the placement that actually earns its keep. The results page is
// printed and handed round a boardroom, or left on a desk, and without this it
// arrives as an anonymous sheet of scores with nothing saying whose work it is
// or how to call them back.
//
// hidden print:block on both halves: on screen the BrandHeader is already up
// there, and two lockups on one page is a mistake nobody would make on purpose.

export function PrintBrandHeader() {
  return (
    <div
      data-print-brand="header"
      className="hidden print:block border-b border-line pb-4 mb-6"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- see BrandHeader */}
      <img src={FW_LOCKUP} alt={FIRM_NAME} width={180} height={24} className="h-6 w-auto" />
    </div>
  );
}

export function PrintBrandFooter() {
  return (
    <div
      data-print-brand="footer"
      className="hidden print:block border-t border-line pt-4 mt-8 text-[10px] leading-relaxed text-ink-muted"
    >
      <p>
        {FIRM_SITE} &middot; {FIRM_PHONE}
      </p>
      <p>{FIRM_ADDRESS}</p>
    </div>
  );
}

// Both halves together, for tests and for anywhere that wants the pair.
export function PrintBrand() {
  return (
    <>
      <PrintBrandHeader />
      <PrintBrandFooter />
    </>
  );
}
