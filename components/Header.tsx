import Image from "next/image";

// White header bar holding F&W's actual logo (public/fw-logo.png, a
// transparent-background export of their real 2-color wordmark, not a
// recreation). Separate component since every page in the app gets this,
// not just the intro.
export function Header() {
  return (
    <header className="bg-white border-b border-line">
      <div className="mx-auto max-w-2xl px-5 py-4">
        <Image
          src="/fw-logo.png"
          alt="Faulk & Winkler"
          width={1201}
          height={156}
          priority
          className="h-8 w-auto"
        />
      </div>
    </header>
  );
}
