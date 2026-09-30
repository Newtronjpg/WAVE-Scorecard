import { FIRM_NAME, FW_LOCKUP } from "@/lib/brand";

// The bar over every screen of the assessment: the firm's lockup, then the
// product name it is serving.
//
// That order is the whole point. Faulk & Winkler is whose assessment this is;
// "WAVE Scorecard" is what the assessment is called. The brand guide puts the
// horizontal lockup top-left on every application it shows, so the firm leads
// and the product follows it rather than the other way round.
//
// The lockup is NOT a link, deliberately. Every other site puts its logo on a
// route home, but whoever is looking at this is partway through a ten-minute
// assessment they will not come back to if they leave, and fw-cpa.com is not
// where that click should go. It is a signature, not navigation.
//
// print:hidden because paper has its own letterhead in PrintBrand -- two
// lockups at the top of one printed page is a mistake nobody makes on purpose.
export function Header() {
  return (
    <header className="bg-white border-b border-line print:hidden">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-4 sm:gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element --
            next/image wants a loader and a layout box for what is a fixed,
            local asset at a fixed size; a plain img with explicit dimensions
            is smaller and shifts nothing. */}
        <img
          src={FW_LOCKUP}
          alt={FIRM_NAME}
          width={160}
          height={21}
          className="h-[21px] w-auto shrink-0"
        />
        {/* A hairline rather than a bullet or a slash: the two marks are
            different things, and a rule says so without adding a character
            that has to be read aloud. */}
        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />
        <span className="font-display text-xl leading-none text-maroon">
          WAVE Scorecard
        </span>
      </div>
    </header>
  );
}
