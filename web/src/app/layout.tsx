import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

// Atkinson Hyperlegible was drawn for readers with low vision: the right face for patients aged 55 and up.
// The mono cut is used for every measured number (degrees, reps, scores), so measurements read like an instrument.
const sans = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-sans", display: "swap", adjustFontFallback: false });
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
