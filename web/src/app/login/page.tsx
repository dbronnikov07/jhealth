// Sign-in for the physiotherapist's dashboard. Public page; the password check and session live in lib/auth-core.ts.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { dashboardAccess, safeNext } from "@/lib/auth-core";
import { LoginForm } from "./LoginForm";
import "./login.css";

export const metadata: Metadata = { title: "Sign in · Motiva Health physio dashboard", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  const next = safeNext((await searchParams).next);
  if (dashboardAccess(await headers()).ok) redirect(next); // already signed in (or this computer, in development)
  const configured = Boolean(process.env.DASHBOARD_PASSWORD);

  return (
    <main className="lg">
      <section className="lg-photo" aria-hidden>
        <Image src="/photos/physio-session.webp" alt="" fill priority sizes="(min-width: 900px) 50vw, 0px" />
        <div className="lg-photo-copy">
          <p className="lg-quote">Every patient&apos;s home exercise, measured rep by rep.</p>
          <p className="lg-quote-sub">Sign in to see who is on track, who is stalling, and who reported pain.</p>
        </div>
      </section>

      <section className="lg-panel">
        <div className="lg-card">
          <Link href="/" className="lg-brand" aria-label="Motiva Health home"><Logo size={30} /></Link>
          <h1>Sign in to the physio dashboard</h1>
          <p className="lg-lede">For the clinic team. Patients never need an account: their private link arrives in the chat.</p>
          {configured ? (
            <LoginForm next={next} />
          ) : (
            <p className="lg-error" role="alert">
              Sign-in is not set up on this server yet. Set DASHBOARD_PASSWORD, then reload this page.
            </p>
          )}
          <ul className="lg-notes">
            <li><Icon name="lock" size={16} /> Patient data stays in Canada, encrypted in transit.</li>
            <li><Icon name="shield" size={16} /> 10 wrong passwords lock that connection out for 15 minutes.</li>
          </ul>
          <Link href="/" className="lg-back">← Back to the Motiva Health site</Link>
        </div>
      </section>
    </main>
  );
}
