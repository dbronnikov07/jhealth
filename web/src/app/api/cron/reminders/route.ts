// Runs the daily reminders (lib/reminders.ts). Call it every hour:
//   - on Vercel: a cron job (vercel.json) with the header  Authorization: Bearer $CRON_SECRET. The free plan allows
//     one run a day (22:00 UTC = 5 pm Toronto); hourly runs, for per-patient reminder hours, need a paid plan.
//   - on this laptop: `npm run reminders` (add ?force=1 to ignore the reminder hour, for a demo)
// Without CRON_SECRET it only answers requests from this computer, and never in production.
import { fromThisComputer, sameSecret } from "@/lib/auth-core";
import { runReminders } from "@/lib/reminders";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const allowed = secret ? sameSecret(auth, `Bearer ${secret}`) : process.env.NODE_ENV !== "production" && fromThisComputer(request.headers);
  if (!allowed) {
    return new Response("Forbidden", { status: 403 });
  }
  const q = new URL(request.url).searchParams;
  const result = await runReminders({ force: q.get("force") === "1", patientId: q.get("patient") ?? undefined });
  return Response.json(result);
}
