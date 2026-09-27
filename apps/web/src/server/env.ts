import "server-only";
import { z } from "zod";

const nonempty = z.string().trim().min(1);
const httpUrl = z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol));
const definitions = {
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonempty,
  SUPABASE_SERVICE_ROLE_KEY: nonempty,
  GOOGLE_CLIENT_ID: nonempty,
  GOOGLE_CLIENT_SECRET: nonempty,
  OPENAI_API_KEY: nonempty,
  OPENAI_MODEL: nonempty,
  JINKO_MCP_URL: httpUrl,
  JINKO_API_KEY: nonempty,
  JINKO_API_KEY_HEADER: z.preprocess((value) => value === "" || value === undefined ? "Authorization" : value, nonempty),
  APP_URL: httpUrl.transform((value) => value.replace(/\/$/, "")),
  APP_SECRET: z.string().min(32),
  SIMULATION_SECRET: z.string().min(32),
};
export class EnvironmentError extends Error {
  constructor(names: string[]) {
    super("Missing or invalid environment variables: " + [...new Set(names)].join(", ") + ". Configure apps/web/.env.local or your deployment environment.");
    this.name = "EnvironmentError";
  }
}
export function getEnv<K extends keyof typeof definitions>(
  keys: readonly K[], source: Record<string, string | undefined> = process.env,
): { [P in K]: z.infer<(typeof definitions)[P]> } {
  const schema = z.object(Object.fromEntries(keys.map((name) => [name, definitions[name]])));
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw new EnvironmentError(parsed.error.issues.map((issue) => String(issue.path[0])));
  return parsed.data as { [P in K]: z.infer<(typeof definitions)[P]> };
}
export const getSupabaseEnv = () => getEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
