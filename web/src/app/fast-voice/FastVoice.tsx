"use client";
import { useEffect, useState } from "react";
import { fastVoiceWanted, findVoiceServer, setFastVoiceWanted } from "@/lib/listen";

type State = "checking" | "on" | "not_running" | "off";

export function FastVoice() {
  const [state, setState] = useState<State>("checking");

  const check = async () => {
    setState("checking");
    const base = await findVoiceServer(true);
    setState(!fastVoiceWanted() ? "off" : base ? "on" : "not_running");
  };

  useEffect(() => {
    // Opening this page is the request to turn it on (the start script opens it).
    setFastVoiceWanted(true);
    void check();
  }, []);

  return (
    <section className="card" aria-live="polite" style={{ marginTop: 24 }}>
      {state === "checking" && <p>Looking for the voice helper on this laptop…</p>}
      {state === "on" && (
        <>
          <h2>Fast voice is on</h2>
          <p>Camera sessions in this browser will use it. If the helper stops, sessions go back to our server by themselves.</p>
        </>
      )}
      {state === "not_running" && (
        <>
          <h2>The voice helper is not running</h2>
          <p>In Terminal, run <code>cd ~/jhealth/web &amp;&amp; npm run voice:start</code>, then check again. If Chrome asks to let this site reach devices on your network, allow it: the helper is on this laptop only.</p>
        </>
      )}
      {state === "off" && (
        <>
          <h2>Fast voice is off</h2>
          <p>Camera sessions in this browser use our server.</p>
        </>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <button className="btn primary" onClick={() => { setFastVoiceWanted(true); void check(); }}>Check again</button>
        <button className="btn" onClick={() => { setFastVoiceWanted(false); setState("off"); }}>Turn off in this browser</button>
      </div>
    </section>
  );
}
