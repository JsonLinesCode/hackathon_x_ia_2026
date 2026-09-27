import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/server/agent/evals/*.eval.ts"], setupFiles: ["src/server/agent/evals/setup.ts"], fileParallelism: false, maxWorkers: 1 },
});
