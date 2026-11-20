// Public privacy policy (Meta asks for one before a WhatsApp app can go live). Every statement here was checked
// against the code on 20 November 2026; where a practice could not be checked, the page says so instead of guessing.
// It describes a student prototype, not a clinic's service: a real deployment needs a lawyer and a data-protection review.
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";

export const metadata: Metadata = {
  title: "Privacy policy · Motiva Health",
  description: "What Motiva Health collects, how WhatsApp messages and the AI coach work, where data is stored and how to have it deleted.",
};

/** The address people write to for questions and deletion. Confirmed by the team before publishing. */
const CONTACT = "forspeakingspeakpeak@gmail.com";
const UPDATED = "20 November 2026";

export default function PrivacyPage() {
  const mail = `mailto:${CONTACT}?subject=${encodeURIComponent("Motiva Health: delete my data")}`;
  return (
    <main className="page patient doc">
      <header className="pt-head">
        <Link href="/" className="brand" aria-label="Motiva Health home"><Logo size={30} /></Link>
        <span className="pt-kicker">Privacy policy</span>
      </header>
      <h1>How Motiva Health handles your information</h1>
      <p className="muted doc-meta">Last updated {UPDATED}.</p>

      <aside className="doc-summary" aria-label="In short">
        <h2>In short</h2>
        <ul>
          <li><Icon name="lock" /><span>Camera video never leaves your device. Only numbers (repetitions, scores, angles) are sent.</span></li>
          <li><Icon name="speaker" /><span>When you talk to the voice coach, your voice is turned into text on our own server. The recording is not kept.</span></li>
          <li><Icon name="chat" /><span>An AI service, Adaption Labs, writes the coach&apos;s replies from your messages.</span></li>
          <li><Icon name="shield" /><span>We do not sell your information, show ads, or use analytics trackers.</span></li>
          <li><Icon name="user" /><span>You can have everything deleted: email <a href={mail}>{CONTACT}</a>.</span></li>
        </ul>
      </aside>

      <section>
        <h2>Who we are</h2>
        <p>
          Motiva Health is a student prototype built at the YHacks 2026 hackathon. It is not a company and not a medical
          device. It helps people do the home exercises their physiotherapist prescribed: a coach on WhatsApp sends the plan
          and reminders and answers questions, a web page uses the phone or laptop camera to count and score repetitions, and
          the physiotherapist sees the results on a dashboard.
        </p>
        <p>Questions about your information: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
      </section>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li><b>From your physiotherapist:</b> your name, your condition (for example knee replacement, right side), your exercise plan, your recovery phase, notes they write for the coach, and, if they add one, an emergency contact&apos;s name and phone number.</li>
          <li><b>When you message us</b> on WhatsApp (or iMessage): your phone number or WhatsApp user ID, your WhatsApp profile name if you are new, the text of your messages, when they were sent, whether our replies were delivered and read, and the reminder time you choose.</li>
          <li><b>Facts the coach saves</b> from your messages, such as a goal, a preferred time to exercise or a pain report. Each fact is linked to the message it came from, so your physiotherapist can see why.</li>
          <li><b>Exercise results:</b> how many repetitions, a quality score for each one, joint angles, and when you exercised. Also the wins you log, like &ldquo;walked around the block&rdquo;.</li>
          <li><b>The voice coach:</b> the text of what you say to it (up to 400 characters at a time) and what it answered.</li>
          <li><b>Check-up visits:</b> the times your physiotherapist offers, the one you pick, and anything you write about when you can come.</li>
          <li><b>Safety alerts:</b> when you report pain or a warning sign, or the camera sees a possible fall.</li>
        </ul>
      </section>

      <section>
        <h2>What we do not collect</h2>
        <ul>
          <li><b>Camera video and pictures.</b> Body tracking runs in your browser, using model files from our own website. Only the numbers above are sent.</li>
          <li><b>Voice recordings.</b> When the voice coach is listening, the sound of your speech is sent to our speech server, turned into text in memory, and not saved. During demonstrations that server can be a computer run by the Motiva team, reached through a Cloudflare tunnel; it works the same way. A voice message you send on WhatsApp is handled like this too: we fetch it from WhatsApp, turn it into text and keep the text, not the recording.</li>
          <li><b>Tracking.</b> No analytics, no advertising, no third-party cookies. The physiotherapist&apos;s dashboard uses one sign-in cookie; your exercise page uses none.</li>
        </ul>
      </section>

      <section>
        <h2>How a WhatsApp message is handled</h2>
        <ul>
          <li>WhatsApp (Meta) delivers your message to our server. We check that it really came from Meta, store it once, and ignore copies.</li>
          <li>A fixed rule written in code reads it first. If it mentions pain of 7 out of 10 or more, or a warning sign such as chest pain or a fall, you get a safety reply, your physiotherapist gets an alert, and the AI is not used.</li>
          <li>Otherwise the AI coach writes a reply and we send it back through WhatsApp. Meta carries the messages under <a href="https://www.whatsapp.com/legal/privacy-policy" target="_blank" rel="noreferrer">WhatsApp&apos;s own privacy policy</a>.</li>
        </ul>
      </section>

      <section>
        <h2>The AI services</h2>
        <p>
          The coach&apos;s replies are written by language models from <b>Adaption Labs</b>. To answer you, we send them: your
          message and the last few messages of the chat, your first name, your condition, your exercise plan and recent
          results, your recovery phase, the facts the coach saved and your physiotherapist&apos;s notes. The voice coach
          sends your first name, your condition, the exercise you are doing, the facts the coach saved and what you just
          said. We do not send your phone number or your full name.
        </p>
        <p>
          If you ask the voice coach about the weather, the name of the city you said is sent to the weather service
          Open-Meteo. Nothing else about you is sent with it.
        </p>
        <p>
          We have not signed a data agreement with Adaption Labs and could not confirm how long they keep what we send. Please
          do not share anything with the coach that you would not want an outside service to see.
        </p>
      </section>

      <section>
        <h2>Where it is stored</h2>
        <ul>
          <li>The database is hosted by Supabase in Canada (Montréal).</li>
          <li>The website and our speech and voice servers run on Vercel, in Montréal, Canada. Vercel keeps standard records of which pages were opened, including the address of your personal exercise page.</li>
          <li>If you text Motiva on iMessage, your messages pass through Apple and through a Mac computer run by the Motiva team, which passes them to our server.</li>
        </ul>
      </section>

      <section>
        <h2>Who can see it</h2>
        <ul>
          <li>Your physiotherapist and the Motiva team, on a dashboard that needs a password.</li>
          <li>The services above, only for the jobs described.</li>
        </ul>
        <p>We do not sell your information or share it for advertising.</p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <p>
          Until it is deleted. There is no automatic deletion yet. When a patient is deleted, everything about them is
          removed from our database: plan, sessions and repetitions, messages, saved facts, alerts, voice coach text, wins
          and recovery phases. Our database provider may keep backups for a short time; we have not confirmed how long.
          Meta, Apple and Adaption Labs keep their own copies under their own policies.
        </p>
      </section>

      <section id="delete">
        <h2>Deleting your information</h2>
        <ul>
          <li>Email <a href={mail}>{CONTACT}</a> with the phone number you used, or ask your physiotherapist. We delete your record from our database and reply when it is done.</li>
          <li>You can stop at any time: just stop replying. WhatsApp only lets us write to you within 24 hours of your last message, so our messages stop too.</li>
        </ul>
      </section>

      <section>
        <h2>Safety</h2>
        <p>
          Motiva Health does not diagnose and does not give medical advice. If you report pain or warning signs, the coach
          asks you to stop and alerts your physiotherapist. In an emergency, call 911. In Ontario, Health811 gives free health
          advice by phone.
        </p>
        <p>Motiva Health is meant for adults.</p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>If what we collect or who we share it with changes, we update this page and the date at the top.</p>
      </section>

      <p className="doc-foot"><Link href="/">← About Motiva Health</Link></p>
    </main>
  );
}
