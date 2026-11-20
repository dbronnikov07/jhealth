import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

// Inter for reading, Outfit for headings and measured numbers (with tabular figures, so digits line up).
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Outfit({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  // Absolute addresses for link previews (iMessage, WhatsApp): the live site, or this computer in development.
  metadataBase: new URL(process.env.PUBLIC_APP_URL || "http://localhost:3100"),
  title: "Motiva Health · Physio dashboard",
  description: "Prescribe home exercises and follow every patient's progress between visits.",
};

export const viewport: Viewport = {
  themeColor: "#f2f4f7",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
