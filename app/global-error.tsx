"use client";

// Last resort: catches errors thrown by the root layout itself, which
// app/error.tsx cannot cover because it renders *inside* that layout.
//
// This one must therefore supply its own <html> and <body>, and cannot
// rely on the app's fonts or Tailwind classes, since the failure may be
// the layout that loads them. Styles are inline for that reason.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#faf8f5",
          color: "#1c1917",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <p
            style={{
              fontSize: "0.75rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#78716c",
              margin: 0,
            }}
          >
            WAVE Scorecard
          </p>
          <h1 style={{ fontSize: "1.5rem", margin: "0.5rem 0 0" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#57534e", lineHeight: 1.6, fontSize: "0.9rem" }}>
            The page couldn&rsquo;t load. This is a problem on our side, not
            anything you did.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              backgroundColor: "#6d0104",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: "2rem",
                fontSize: "0.75rem",
                color: "#78716c",
              }}
            >
              Reference: <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
