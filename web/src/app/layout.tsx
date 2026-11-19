import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Figtree } from "next/font/google";
import "./globals.css";

// Figtree: open, friendly and very legible at large sizes (the body face Sword Health uses; recommended for
// healthcare). Atkinson Hyperlegible Mono, drawn for readers with low vision, sets every measured number
// (degrees, reps, scores), so measurements read like an instrument.
const sans = Figtree({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", adjustFontFallback: false });

export const metadata: Metadata = {
  title: "jHealth · Physio dashboard",
  description: "Prescribe home exercises and follow every patient's progress between visits.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f16" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
