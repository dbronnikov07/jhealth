"use client";
// A destructive button that asks once more in place: the first tap turns it into "Tap again to …" for 5 seconds.
import { useEffect, useState } from "react";

export function ConfirmButton({ action, label, confirm, danger = false }: {
  action: () => Promise<void>; label: string; confirm: string; danger?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn small${danger && armed ? " danger" : ""}${armed ? " armed" : ""}`}
      disabled={busy}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        try { await action(); } finally { setBusy(false); setArmed(false); }
      }}
    >
      {busy ? "Working…" : armed ? confirm : label}
    </button>
  );
}
