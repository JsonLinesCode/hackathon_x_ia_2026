import "server-only";
import { createUserClient } from "./db";

export const GOOGLE_SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;
export class UnauthorizedError extends Error {
  constructor() { super("Sign in to continue."); }
}
export async function requireUser() {
  const db = await createUserClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new UnauthorizedError();
  return { db, user };
}
