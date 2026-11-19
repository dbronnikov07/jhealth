// The dashboard's access check for server code (actions and data reads). See auth-core.ts for the rules.
import "server-only";
import { headers } from "next/headers";
import { dashboardAccess } from "./auth-core";

export class NotAuthorizedError extends Error {}

/** Call first in every dashboard server action and data read. Throws if the caller may not use the dashboard. */
export async function requireDoctor(): Promise<void> {
  const access = dashboardAccess(await headers());
  if (!access.ok) throw new NotAuthorizedError(access.message);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id that came from the browser: must look like a database id, or the action stops. */
export function assertUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new NotAuthorizedError("Invalid id");
  return value;
}
