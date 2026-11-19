import Link from "next/link";
import { signOut } from "@/app/login/actions";

import { imessageBridgeOnline } from "@/lib/data";
import { whatsappConfig } from "@/lib/whatsapp/client";
import { Goniometer } from "./Goniometer";

function initials(name: string): string {
  const words = name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/[\s,]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export async function TopBar({ doctor, mode }: { doctor?: { name: string; clinic: string | null }; mode: "supabase" | "local" }) {
  const whatsapp = whatsappConfig() !== null;
  const imessage = await imessageBridgeOnline().catch(() => false);
  return (
    <header className="topbar">
      <Link href="/doctor" className="brand">
        <Goniometer value={62} size={28} />
        <span className="wordmark">j<span>Health</span></span>
      </Link>
      <span className="sub">Physio dashboard</span>
      <div className="right">
        <span className="env" title={mode === "local" ? "PGlite: Postgres running on this computer" : "Supabase Postgres"}>
          <i aria-hidden /> {mode === "local" ? "Local database" : "Supabase"}
        </span>
        <span
          className={`env ${imessage ? "on" : "off"}`}
          title={imessage ? "The iMessage bridge on the Mac is running" : "Start the bridge on the Mac: npm run imessage:bridge"}
        >
          <i aria-hidden /> <span>iMessage<span className="long">{imessage ? " connected" : " offline"}</span></span>
        </span>
        {whatsapp && (
          <span className="env on" title="Messages are sent through the WhatsApp Cloud API">
            <i aria-hidden /> <span>WhatsApp<span className="long"> connected</span></span>
          </span>
        )}
        {doctor && (
          <span className="who">
            <span className="avatar" aria-hidden>{initials(doctor.name)}</span>
            <span className="name">{doctor.name}{doctor.clinic && <span className="clinic"> · {doctor.clinic}</span>}</span>
          </span>
        )}
        {process.env.DASHBOARD_PASSWORD && (
          <form action={signOut}>
            <button type="submit" className="signout">Sign out</button>
          </form>
        )}
      </div>
    </header>
  );
}
