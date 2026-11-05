// Befunde des Bereinigers (`svg-guard`, code-kit 0.58.0) lesen: `too-costly` hat zwei Ursachen. Die Schätzung der Zeichenkosten ("estimated render cost 2002001 exceeds the limit of 1000000 (…)")
// beruht auf Verweisen, Filtern, Strichen und Stilregeln und lässt sich durch ein einfacheres Bild beheben; die Grenzen der Menge ("the style sheets have 303889 characters, the limit is 250000",
// "the value of clip-path has … characters", "… names … references") nennen ein zu großes Dokument. Das Kit liefert beides als Text; die Form ist hier an einer Stelle gebunden (Test gegen den echten Bereiniger).

/** Die Schätzung der Zeichenkosten aus dem Detail eines `too-costly`-Befunds: `ratio` ist Kosten durch Grenze, `null` bei „unbounded“ (der Wert lief über). `null`, wenn der Befund eine Mengengrenze meldet. */
export function costEstimate(p: { code: string; detail: string }): { ratio: number | null } | null {
  if (p.code !== "too-costly") return null;
  const m = /^estimated render cost (\d+|unbounded) exceeds the limit of (\d+)/.exec(p.detail);
  if (m === null) return null;
  const limit = Number(m[2]);
  return { ratio: m[1] === "unbounded" || !(limit > 0) ? null : Number(m[1]) / limit };
}

/** `too-costly` wegen einer Mengengrenze (Stilblatt, Wert, Verweise): ein Modell kann es nicht durch ein einfacheres Bild beheben, und der Text ist riesig. */
export const isSizeLimit = (p: { code: string; detail: string }): boolean => p.code === "too-costly" && costEstimate(p) === null;
