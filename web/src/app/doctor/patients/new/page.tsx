import Link from "next/link";
import { connection } from "next/server";
import { TopBar } from "@/components/TopBar";
import { getDoctor } from "@/lib/data";
import { NewPatientForm } from "./NewPatientForm";

export default async function NewPatientPage() {
  await connection();
  const { doctor, mode } = await getDoctor();
  return (
    <>
      <TopBar doctor={doctor} mode={mode} />
      <main className="page">
        <Link href="/doctor" className="back">← All patients</Link>
        <header className="record">
          <h1>Add patient</h1>
          <p className="muted">Next you choose their exercises. The plan goes to them on WhatsApp with a Start button.</p>
        </header>
        <section className="card" style={{ maxWidth: 600 }}>
          <NewPatientForm />
        </section>
      </main>
    </>
  );
}
