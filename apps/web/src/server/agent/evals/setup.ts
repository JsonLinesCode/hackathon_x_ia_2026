import { existsSync } from "node:fs";
import { resolve } from "node:path";
// Node loads environment variables without logging secrets. CI can supply them directly.
const envFile = resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) throw new Error("eval:agent requires OPENAI_API_KEY and OPENAI_MODEL in apps/web/.env.local or the environment.");
