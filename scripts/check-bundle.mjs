// Bundle-Groessenschranke: faengt versehentliche Zusatz-Deps ab. Schranke bewusst anheben, wenn eine Dependency gewollt ist.
import { readFileSync, statSync } from "node:fs";

// 2026-11-05 von 300 auf 400 angehoben (gewollt): das Panel trägt die LLM-Verbindung, Modellzeile, Prüfliste, Texteingabe und Zahlenfelder aus dem Kit (main.js 297 KB bei Plan 2 D2).
const LIMIT_KB = 400;
const sizeKb = statSync("main.js").size / 1024;

if (sizeKb > LIMIT_KB) {
  console.error(`main.js ist ${sizeKb.toFixed(0)} KB — Schranke ${LIMIT_KB} KB.`);
  console.error("Neue Dependency dazugekommen? Sonst Schranke bewusst anheben.");
  process.exit(1);
}
console.log(`main.js: ${sizeKb.toFixed(0)} KB (Schranke ${LIMIT_KB} KB)`);

// CodeMirror gehoert Obsidian: das Bundle darf keine eigene Kopie tragen
// (zwei EditorView-Klassen kennen die Erweiterungen des jeweils anderen nicht).
// Laufzeit-Klassennamen ueberleben die Minifizierung und stehen im Bundle, sobald CodeMirror mitgebuendelt ist.
const forbidden = "cm-scroller";
const bundle = readFileSync("main.js", "utf8");
if (bundle.includes(forbidden)) {
  console.error(`main.js enthaelt "${forbidden}" — eine eigene CodeMirror-Kopie ist im Bundle gelandet (external pruefen).`);
  process.exit(1);
}
console.log("main.js: kein eigenes CodeMirror im Bundle");
