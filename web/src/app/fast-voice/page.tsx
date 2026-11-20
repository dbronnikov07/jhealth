// Turns the fast voice on for this browser, on the demo laptop where the voice helper runs (npm run voice:start
// opens this page). Nothing private here: it only sets a flag in this browser and checks 127.0.0.1:8799.
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { FastVoice } from "./FastVoice";

export const metadata: Metadata = { title: "Fast voice · Motiva Health", robots: { index: false, follow: false } };

export default function FastVoicePage() {
  return (
    <main className="page patient doc">
      <header className="pt-head">
        <Link href="/" className="brand" aria-label="Motiva Health home"><Logo size={30} /></Link>
        <span className="pt-kicker">Fast voice</span>
      </header>
      <h1>Fast voice on this laptop</h1>
      <p className="muted">
        The coach hears you and answers with its voice made on this laptop instead of on our server: about one second
        from the end of your sentence to its first word, instead of three. Camera video and sound stay on this laptop.
      </p>
      <FastVoice />
    </main>
  );
}
