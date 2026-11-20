import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Funnel_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";

// Bricolage Grotesque for headings and big numbers (its optical sizes keep big type tight and warm), Funnel Sans for
// reading, Geist Mono for measurements and labels. (Funnel Display was tried: its "b" has a detached spur that read
// as a full stop in "rehab".)
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap", axes: ["opsz"] });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono-face", display: "swap" });

export const metadata: Metadata = {
  // Absolute addresses for link previews (iMessage, WhatsApp): the live site, or this computer in development.
  metadataBase: new URL(process.env.PUBLIC_APP_URL || "http://localhost:3100"),
  title: "Motiva Health · Physio dashboard",
  description: "Prescribe home exercises and follow every patient's progress between visits.",
};

export const viewport: Viewport = {
  themeColor: "#f1f2ec",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
