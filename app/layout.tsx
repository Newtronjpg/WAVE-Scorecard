import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// Display serif: EB Garamond, not Fraunces. A moderate-contrast old-style
// serif suits a professional-services wordmark without tipping into the
// higher-contrast, more fashion-adjacent look of something like Playfair
// Display. EB Garamond's proportions and restrained contrast are the
// closest free match to that character.
const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WAVE Scorecard",
  description:
    "A transaction-readiness assessment from your advisory firm.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${ebGaramond.variable} ${inter.variable}`}>
      <body className="min-h-screen antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
