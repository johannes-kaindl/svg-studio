// Probleme des Kerns als Wert: ein Code und Parameter, nie ein Satz. Die Oberfläche übersetzt (`src/i18n/strings.ts`, `problemText`), der Kern bleibt sprachfrei
// (Rest-Task C4 Punkt 9). Was ans MODELL geht (`protocol.ts`), bleibt ein deutscher Satz und ist kein `Problem`.
// `detail`-Parameter tragen den Text einer tieferen Schicht (Scanner, `applyChanges`), der noch nicht in Codes gefasst ist; er erscheint dort unübersetzt.
export const PROBLEM_CODES = [
  "no-base", // Es gibt keinen Text, auf dem die Runde aufsetzt.
  "names-unreadable", // Der Text ist nicht lesbar; Namen lassen sich nicht vergeben.
  "attr-changed", // [key, attr, jetzt|null, Runde|null]: ein Attribut hat sich seit der Runde geändert.
  "element-missing", // [key]: ein Element, das die Runde anfasst, gibt es nicht mehr.
  "element-changed", // [key]: ein Element, das die Runde entfernen will, hat sich seit der Runde geändert.
  "apply-failed", // [detail]: applyChanges lehnt aus einem anderen Grund ab; der Text ist der von `changes.ts` und noch nicht übersetzt (Rest-Task).
  "target-changed", // Das Ziel hat sich seit der Runde geändert (ganzes Bild).
  "names-changed", // Die Elemente ohne Namen haben sich seit der Runde geändert.
  "round-missing", // [n]: Die Runde baut auf Runde n, die es nicht gibt.
  "round-locked", // [n]: Auf Runde n baut schon eine weitere auf.
  "round-unknown", // [n]: Es gibt keine Runde n.
  "entry-unknown", // [n]: Die Runde hat keinen Eintrag n.
  "entry-single", // Die Runde hat nur einen Eintrag.
  "entry-none", // Diese Runde hat keine Einträge, über die sich einzeln entscheiden ließe.
  "hand-no-text", // Es gibt keinen Text, an dem sich etwas von Hand ändern ließe.
  "chain-broken", // Die Rundenfolge ist beschädigt.
  "nothing-to-apply", // Es gibt nichts anzuwenden.
  "text-unreadable", // [detail, offset]: Der Text ist nicht lesbar.
  "editor-unnamed", // [namen]: Elemente ohne id tragen Editor-Angaben.
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

export interface Problem {
  code: ProblemCode;
  /** Zahlen und Zeichenketten; `null` heißt „nicht gesetzt“ (die Oberfläche setzt das Wort ein). */
  params: ReadonlyArray<string | number | null>;
  /** Nummer der Runde (1-basiert, wie das Panel sie zeigt), an der ein Übernehmen scheiterte. */
  round?: number;
}
