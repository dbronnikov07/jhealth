"use server";
// Signing in and out of the physio dashboard (rules in lib/auth-core.ts).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, createSession, safeNext, sessionCookieName } from "@/lib/auth-core";

export type SignInState = { error: string | null };

const production = () => process.env.NODE_ENV === "production";

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const password = String(form.get("password") ?? "");
  const env = { password: process.env.DASHBOARD_PASSWORD, production: production() };
  const result = checkPassword(await headers(), password, env);
  if (!result.ok) return { error: result.message };

  const session = createSession(env.password as string);
  (await cookies()).set(sessionCookieName(env.production), session.value, {
    httpOnly: true, secure: env.production, sameSite: "lax", path: "/", maxAge: session.maxAge,
  });
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  (await cookies()).set(sessionCookieName(production()), "", {
    httpOnly: true, secure: production(), sameSite: "lax", path: "/", maxAge: 0,
  });
  redirect("/login");
}
