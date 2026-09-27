import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
const [origin, destination, city, departureDate, returnDate] = process.argv.slice(2);
if (!origin || !destination || !city || !departureDate || !returnDate) {
  console.error('Usage: node apps/web/scripts/check-jinko-search.mjs ORIGIN DESTINATION "Hotel city or landmark" YYYY-MM-DD YYYY-MM-DD');
  process.exit(1);
}
const header = process.env.JINKO_API_KEY_HEADER?.trim() || "Authorization";
const key = process.env.JINKO_API_KEY?.trim();
if (!key || !process.env.JINKO_MCP_URL) throw new Error("Set JINKO_API_KEY and JINKO_MCP_URL.");
const client = new Client({ name: "travel-manager-read-check", version: "1.0.0" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.JINKO_MCP_URL), {
    requestInit: { headers: { [header]: header.toLowerCase() === "authorization" ? "Bearer " + key : key } },
  }), { timeout: 30000 });
  for (const [name, args] of [
    ["flight_search", { search: { origin, origin_type: "airport", destination, departure_date: departureDate, return_date: returnDate, limit: 3 }, passengers: { adults: 1 }, currency: "EUR" }],
    ["hotel_search", { destination: { query: city }, checkin: departureDate, checkout: returnDate, occupancies: [{ adults: 1 }], currency: "EUR", filters: { max_results: 3 } }],
  ]) {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
    const content = result.structuredContent;
    if (result.isError || content?.status === "error") {
      const code = typeof content?.error === "string" ? content.error : content?.error?.code;
      console.error(name + ": " + (/^[a-zA-Z0-9_]+$/.test(code || "") ? code : "provider_error"));
      process.exitCode = 1;
    } else {
      const data = content?.data ?? content;
      console.log(name + ": " + JSON.stringify({ status: content?.status, count: data?.flights?.length ?? data?.hotels?.length ?? 0 }));
    }
  }
} catch (error) {
  console.error("Jinko check failed: " + String(error instanceof Error ? error.message : error).replaceAll(key, "[redacted]"));
  process.exitCode = 1;
} finally { await client.close(); }
