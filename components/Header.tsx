// White header bar holding the product wordmark. Separate component
// since every page in the app gets this, not just the intro.
export function Header() {
  return (
    <header className="bg-white border-b border-line">
      <div className="mx-auto max-w-2xl px-5 py-4">
        <span className="font-display text-xl text-maroon">WAVE Scorecard</span>
      </div>
    </header>
  );
}
