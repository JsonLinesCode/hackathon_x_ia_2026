import { Button } from "@repo/ui/button";
import { PlaneTakeoff } from "lucide-react";
import { EnvironmentError, getEnv } from "@/server/env";

export const dynamic = "force-dynamic";
const errors: Record<string, string> = {
  signin: "Google sign-in could not start. Check the Google provider in Supabase, then try again.",
  callback: "The sign-in link expired or could not be verified. Please sign in again.",
  consent: "Google access was not granted. In Google Cloud Testing mode, add your email as a test user, then try again.",
  unavailable: "The sign-in service is unavailable. Please try again.",
};
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  let configurationError = "";
  try { getEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APP_URL"]); }
  catch (cause) { configurationError = cause instanceof EnvironmentError ? cause.message : "Unable to read the application configuration."; }
  return (
    <main className="login-layout">
      <section className="surface login-panel form-stack">
        <div className="inline-detail"><span className="brand-mark"><PlaneTakeoff size={18} /></span><strong>Travel Manager</strong></div>
        <div><h1>Bring your team together.</h1><p className="muted">Sign in to manage your travelers, company policy and business trips.</p></div>
        {(configurationError || (error && errors[error])) && <p className="inline-alert tone-warning" role="alert">{configurationError || errors[error!]}</p>}
        <form action="/auth/signin" method="post">
          <Button className="full-width" type="submit" disabled={Boolean(configurationError)}>Continue with Google</Button>
        </form>
        <p className="muted small">Connect your work account to coordinate calendars and send travel updates on your behalf.</p>
      </section>
    </main>
  );
}
