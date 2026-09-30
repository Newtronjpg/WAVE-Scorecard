import { FW_SPARK } from "@/lib/brand";

// The guide's "Outlined Spark", Grey 1, large and faint in the bottom-right --
// the same move the guide's own website mockup makes.
//
// aria-hidden and role-less: it carries no information, and announcing an
// image over a results page someone is trying to read is noise. print:hidden
// because a full-page pale shape is pure wasted toner.
//
// pointer-events-none so it cannot swallow a click meant for the content it
// sits behind, and overflow is clipped by the wrapper rather than the shape
// being scaled down -- the guide uses it bleeding off the edge, not contained.
export function SparkWatermark() {
  return (
    <div
      aria-hidden="true"
      data-spark="true"
      className="pointer-events-none select-none absolute inset-0 -z-10 overflow-hidden print:hidden"
    >
      <div
        className="absolute -right-24 bottom-0 h-[420px] w-[420px] bg-no-repeat bg-contain opacity-60 sm:h-[560px] sm:w-[560px]"
        style={{ backgroundImage: `url(${FW_SPARK})` }}
      />
    </div>
  );
}
