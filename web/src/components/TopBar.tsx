import Link from "next/link";

import { whatsappConfig } from "@/lib/whatsapp/client";
import { Goniometer } from "./Goniometer";

function initials(name: string): string {
  const words = name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/[\s,]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function TopBar({ doctor, mode }: { doctor?: { name: string; clinic: string | null }; mode: "supabase" | "local" }) {
  const whatsapp = whatsappConfig() !== null;
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
          className={`env ${whatsapp ? "on" : "off"}`}
          title={whatsapp ? "Messages are sent through the WhatsApp Cloud API" : "Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID to send messages"}
        >
          <i aria-hidden /> <span>WhatsApp<span className="long">{whatsapp ? " connected" : " not connected"}</span></span>
        </span>
        {doctor && (
          <span className="who">
            <span className="avatar" aria-hidden>{initials(doctor.name)}</span>
            <span className="name">{doctor.name}{doctor.clinic && <span className="clinic"> · {doctor.clinic}</span>}</span>
          </span>
        )}
      </div>
    </header>
  );
}
