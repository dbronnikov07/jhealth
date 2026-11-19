"use client";
import { useActionState, useState } from "react";
import { Icon } from "@/components/Icon";
import { signIn, type SignInState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null });
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="lg-form" noValidate>
      <input type="hidden" name="next" value={next} />
      {/* Lets password managers file the password under a name; never shown. */}
      <input className="sr-only" type="text" name="username" autoComplete="username" value="jHealth dashboard" readOnly tabIndex={-1} aria-hidden />
      <label htmlFor="lg-password">Dashboard password</label>
      <div className={`lg-field${state.error ? " has-error" : ""}`}>
        <Icon name="lock" size={18} />
        <input
          id="lg-password"
          name="password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          required
          maxLength={200}
          autoFocus
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "lg-error" : "lg-hint"}
        />
        <button type="button" className="lg-show" onClick={() => setShow((s) => !s)} aria-pressed={show}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {state.error ? (
        <p id="lg-error" className="lg-error" role="alert">{state.error}</p>
      ) : (
        <p id="lg-hint" className="lg-hint">The clinic&apos;s shared password. You stay signed in on this device for 12 hours.</p>
      )}
      <button className="lg-submit" type="submit" disabled={pending}>
        {pending ? "Signing in…" : <>Sign in <Icon name="arrow" size={18} /></>}
      </button>
    </form>
  );
}
