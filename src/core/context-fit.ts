// Passt die Eingabe in den Kontext des Modells? (Gesamtreview Befund 9.) Rein und ohne DOM: die Grenze holt die Obsidian-Schicht beim Endpunkt.
// Ein SVG ist zahlenreich und kostet mehr Token je Zeichen als Prosa; hier wird bewusst **optimistisch** gerechnet (4 Zeichen je Token). Gesperrt wird nur,
// was selbst so nicht passt: eine falsch gesperrte Anfrage wäre schlimmer als ein Serverfehler, den es ohne diese Prüfung auch gäbe.

/** Zeichen je Token der Schätzung; absichtlich großzügig (Prosa liegt bei 3,5, ein SVG darunter). */
export const OPTIMISTIC_CHARS_PER_TOKEN = 4;

export interface InputOverflow {
  /** Geschätzte Token der Eingabe (aufgerundet). */
  tokens: number;
  /** Der Kontext, gegen den verglichen wurde. */
  limit: number;
}

/** `null`, wenn die Eingabe passt oder die Grenze unbekannt ist; sonst Schätzung und Grenze. Verglichen wird nur die Eingabe: wie viel das Modell antwortet,
 *  hängt vom Server ab (er beendet mit `finish_reason: length`), und `max_tokens` 16384 allein sperrte jedes Modell mit kleinem Kontext. */
export function inputOverflow(messages: ReadonlyArray<{ content: string }>, contextLimit: number | null): InputOverflow | null {
  if (contextLimit === null || !Number.isFinite(contextLimit) || contextLimit <= 0) return null;
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const tokens = Math.ceil(chars / OPTIMISTIC_CHARS_PER_TOKEN);
  return tokens > contextLimit ? { tokens, limit: contextLimit } : null;
}
