import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    env: {
      LLM_STUB: "1",
      DATABASE_URL: "postgresql://exhibit:exhibit@localhost:5433/exhibit_test",
    },
    testTimeout: 30000,
  },
});
