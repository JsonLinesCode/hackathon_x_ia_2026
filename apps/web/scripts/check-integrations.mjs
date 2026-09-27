import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing " + name);
  return value;
};
const redact = (message) => {
  let safe = String(message);
  for (const name of ["OPENAI_API_KEY", "JINKO_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (process.env[name]) safe = safe.replaceAll(process.env[name], "[redacted]");
  }
  return safe;
};

async function jinko() {
  const header = process.env.JINKO_API_KEY_HEADER?.trim() || "Authorization";
  const key = required("JINKO_API_KEY");
  const client = new Client({ name: "travel-manager-discovery", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(required("JINKO_MCP_URL")), {
    requestInit: {
      headers: { [header]: header.toLowerCase() === "authorization" ? "Bearer " + key : key },
      signal: AbortSignal.timeout(60000),
    },
  });
  try {
    await client.connect(transport);
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    const snapshot = { captured_at: new Date().toISOString(), tools };
    console.log("Jinko listTools():\n" + JSON.stringify(tools.map(({name, inputSchema}) => ({name, inputSchema})), null, 2));
    await mkdir(new URL("../../../docs/", import.meta.url), { recursive: true });
    await writeFile(new URL("../../../docs/jinko-tools.json", import.meta.url), JSON.stringify(snapshot, null, 2) + "\n");
  } finally {
    await client.close();
  }
}

async function openai() {
  const model = required("OPENAI_MODEL");
  const client = new OpenAI({ apiKey: required("OPENAI_API_KEY"), timeout: 30000, maxRetries: 1 });
  const response = await client.responses.parse({
    model, store: false,
    input: "Return ok=true to verify structured outputs connectivity.",
    text: { format: zodTextFormat(z.object({ ok: z.boolean() }), "connection_check") },
  });
  if (response.output_parsed?.ok !== true) throw new Error("OpenAI returned no valid structured output");
  console.log("OpenAI check: " + JSON.stringify({ configured_model: model, returned_model: response.model, output: response.output_parsed }));
}

for (const [name, check] of [["Jinko", jinko], ["OpenAI", openai]]) {
  try { await check(); } catch (error) {
    console.error(name + " check failed: " + redact(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}
