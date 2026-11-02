// `src/core/` muss frei von obsidian- UND @codemirror-Importen bleiben — das ist die
// Zusicherung, dass die Fachlogik ohne Obsidian testbar ist. Fehlt der Ordner (noch kein Kern), ist nichts zu pruefen.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/core";
const FORBIDDEN = /(?:from|import)\s*\(?\s*["'](obsidian|@codemirror\/[^"']*)(\/[^"']*)?["']/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const offenders = existsSync(ROOT)
  ? walk(ROOT)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")))
  : [];

if (offenders.length > 0) {
  console.error("src/core darf weder obsidian noch @codemirror importieren:");
  for (const file of offenders) console.error(`  ${file}`);
  process.exit(1);
}

console.log(`check:pure: ${ROOT} ist frei von obsidian/@codemirror${existsSync(ROOT) ? "" : " (Ordner fehlt noch)"}`);
