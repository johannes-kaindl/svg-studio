import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standard ist `node`; ein Test, der DOM braucht, setzt in der Kopfzeile
// `// @vitest-environment happy-dom` (happy-dom kommt mit dem ersten solchen Test als devDependency).
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      // Mock-Alias gehoert in vitest, NIE in tsconfig.json (PROF-OBS-08):
      obsidian: fileURLToPath(new URL("./tests/__mocks__/obsidian.ts", import.meta.url)),
    },
  },
});
