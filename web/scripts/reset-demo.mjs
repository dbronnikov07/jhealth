// Fresh demo data for the pitch: deletes the 20 SIMULATED patients (and their plans, sessions, messages) from the
// local database, so the next `npm run dev` creates them again with dates relative to today. Real patients (the
// ones who messaged the WhatsApp number) are kept.
//
// Stop the dev server first (the local database is a folder only one process may open), then:
//   npm run demo:reset
//   npm run dev
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const dir = process.env.PGLITE_DIR ?? path.join(os.homedir(), "jhealth-cache", "pglite-dev");
if (!existsSync(dir)) {
  console.log(`No local database at ${dir}: nothing to reset. \`npm run dev\` will create it.`);
  process.exit(0);
}
const db = new PGlite(dir);
try {
  const before = (await db.query("select count(*)::int as n from patients where is_simulated")).rows[0].n;
  const real = (await db.query("select count(*)::int as n from patients where not is_simulated")).rows[0].n;
  await db.query("delete from patients where is_simulated");
  console.log(`Deleted ${before} simulated patients; kept ${real} real patient(s). Run \`npm run dev\`: the simulated ones come back with today's dates.`);
} catch (error) {
  console.error("Could not reset. Is the dev server still running? Stop it first.", error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
