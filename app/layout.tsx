import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import "./globals.css";

// Display serif: EB Garamond, not Fraunces. F&W's real logo already uses a
// moderate-contrast old-style serif for "Faulk&Winkler" (see public/fw-logo.png),
// so a serif display face is justified by the actual brand, not just picked
// because "serif reads premium." EB Garamond's proportions and restrained
// contrast are the closest free match to that wordmark's character, closer
// than higher-contrast options like Playfair Display.
const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WAVE Scorecard | Faulk & Winkler",
  description:
    "A transaction-readiness assessment from Faulk & Winkler Advisory Services.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${ebGaramond.variable} ${inter.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
