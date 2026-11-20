import type { Metadata, Viewport } from "next";
import { Caveat, Figtree } from "next/font/google";
import "./globals.css";

// Figtree for everything you read (800 for headings, tight), Caveat for the handwritten notes on photos.
const sans = Figtree({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const hand = Caveat({ subsets: ["latin"], variable: "--font-hand", display: "swap", weight: ["600", "700"] });

export const metadata: Metadata = {
  // Absolute addresses for link previews (iMessage, WhatsApp): the live site, or this computer in development.
  metadataBase: new URL(process.env.PUBLIC_APP_URL || "http://localhost:3100"),
  title: "Motiva Health · Physio dashboard",
  description: "Prescribe home exercises and follow every patient's progress between visits.",
};

export const viewport: Viewport = {
  themeColor: "#f5f0e6",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
