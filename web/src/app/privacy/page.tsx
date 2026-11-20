// Public privacy policy. Meta requires a privacy policy address before a WhatsApp app can be published.
// DRAFT for the YHacks 2026 prototype: a real deployment needs a lawyer and a clinic's data-protection review.
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";

export const metadata: Metadata = { title: "Privacy · Motiva Health" };

export default function PrivacyPage() {
  return (
    <main className="page patient doc">
      <header className="pt-head">
        <Link href="/" className="brand" aria-label="Motiva Health home"><Logo size={30} /></Link>
        <span className="pt-kicker">Privacy policy</span>
      </header>
      <h1>How Motiva Health handles your information</h1>
      <p className="muted doc-meta">Prototype built for YHacks 2026. Last updated 19 November 2026.</p>

      <aside className="doc-summary" aria-label="In short">
        <h2>In short</h2>
        <ul>
          <li><Icon name="lock" /><span>Camera video never leaves your device. Only numbers are sent.</span></li>
          <li><Icon name="shield" /><span>We do not sell your information or use it for advertising.</span></li>
          <li><Icon name="user" /><span>You can stop at any time, or ask your physiotherapist to delete your information.</span></li>
        </ul>
      </aside>

      <section>
        <h2>What Motiva Health is</h2>
        <p>Motiva Health helps people do the home exercises their physiotherapist prescribed. It sends reminders and tips on WhatsApp, counts and scores repetitions on a web page using the device&apos;s camera, and shows the physiotherapist how it is going.</p>
      </section>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li><b>Your phone number and WhatsApp name</b>, when you message the Motiva Health WhatsApp number.</li>
          <li><b>The messages you send</b> to Motiva Health on WhatsApp, and facts the coach saves from them (for example a goal or a preferred time to exercise).</li>
          <li><b>Exercise results as numbers</b>: how many repetitions, a quality score, joint angles and timing.</li>
        </ul>
      </section>

      <section>
        <h2>What we never collect</h2>
        <p><b>Camera video never leaves your device.</b> The pose tracking runs in your browser; only the numbers above are sent.</p>
      </section>

      <section>
        <h2>Who sees it</h2>
        <ul>
          <li>Your physiotherapist, on the Motiva Health dashboard.</li>
          <li>Meta (WhatsApp), which carries the messages under WhatsApp&apos;s own terms.</li>
          <li>Adaption Labs, whose language models write the coach&apos;s replies. Your message and the context needed to answer it are sent to them for that purpose only.</li>
        </ul>
        <p>We do not sell your information or use it for advertising.</p>
      </section>

      <section>
        <h2>Safety</h2>
        <p>Motiva Health does not diagnose or give medical advice. If you report pain or warning signs, the coach asks you to stop and alerts your physiotherapist. In an emergency, call 911.</p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>You can stop at any time by not replying, or ask your physiotherapist to delete your information. In this prototype, the data of demo participants is deleted after the hackathon.</p>
      </section>

      <p className="doc-foot"><Link href="/">← About Motiva Health</Link></p>
    </main>
  );
}
