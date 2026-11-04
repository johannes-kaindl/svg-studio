// Die Brücke zwischen der Kit-Verbindung (`LlmConnection.complete` → `LlmResult`) und `askUntilValid` (`ask: messages → AskReply`, wirft bei einem Fehler).
// Kit-Baustein K5 ist auf `RepairResult` (json-editor) zugeschnitten und passt nicht (Plan 2, Tabelle „Kit-Bausteine“); diese Datei bleibt hier.
// Sie liegt in der Obsidian-Schicht und baut auf `LlmConnection`; ob ein zweiter Träger sie braucht, entscheidet das Bibliothek-Gate (Kit-Task „K5 nach K14 neu zuschneiden“).
import type { AskReply, TextMessage } from "../vendor/kit/answer-retry";
import type { SourceKind } from "../vendor/kit/endpoint-source";
import type { LlmConnection } from "../vendor/kit-obsidian/llm-connection";

/** Warum eine Anfrage keine Antwort brachte: abgebrochen, kein Endpunkt (mit Grund und Art der Quelle) oder ein Fehler des Servers bzw. des Netzes. */
export class LlmAskError extends Error {
  readonly kind: "aborted" | "no-endpoint" | "error";
  readonly detail: string;
  /** Bei `no-endpoint`: woher der Endpunkt kommen sollte (Endpunkt-Manager oder lokale Liste); der Text zum Grund hängt daran. */
  readonly sourceKind: SourceKind | null;

  constructor(kind: LlmAskError["kind"], detail: string, sourceKind: SourceKind | null = null) {
    super(detail);
    this.name = "LlmAskError";
    this.kind = kind;
    this.detail = detail;
    this.sourceKind = sourceKind;
  }
}

export interface AskForOptions {
  signal: AbortSignal;
  onToken: (text: string) => void;
  onReasoning: (text: string) => void;
  /** Der bisher gelieferte Text war Denken (Gemma 4 ohne Öffner): die Anzeige verwirft ihn. */
  onContentReset: () => void;
  /** Vor jeder Anfrage, 1-basiert: der erste Versuch ist 1, die Rückfrage danach 2. */
  onAttempt: (n: number) => void;
}

/** Eine Anfrage an das Modell als `ask` für `askUntilValid`. Bei `ok` zählt der Inhalt der Antwort, fehlt er, der gestreamte Text; `truncated` kommt vom Server
 *  (`finish_reason: length`). Bei einem Fehler wirft sie `LlmAskError` (`askUntilValid` wiederholt keine geworfene Anfrage: ein zweites Fragen ändert den Zustand des Servers nicht). */
export function askFor(llm: Pick<LlmConnection, "complete">, o: AskForOptions): (messages: TextMessage[]) => Promise<AskReply> {
  let attempt = 0;
  return async (messages) => {
    attempt += 1;
    o.onAttempt(attempt);
    let streamed = "";
    const r = await llm.complete(
      { messages },
      {
        signal: o.signal,
        onToken: (text) => { streamed += text; o.onToken(text); },
        onReasoning: o.onReasoning,
        onContentReset: () => { streamed = ""; o.onContentReset(); },
      },
    );
    // Abgebrochen heißt abgebrochen, auch wenn das Ergebnis noch „ok“ ankam.
    if (o.signal.aborted) throw new LlmAskError("aborted", "aborted");
    if (!r.ok) {
      if (r.kind === "aborted") throw new LlmAskError("aborted", r.detail);
      if (r.kind === "no-endpoint") throw new LlmAskError("no-endpoint", r.detail, r.source.kind);
      throw new LlmAskError("error", r.detail);
    }
    return { content: r.content !== "" ? r.content : streamed, truncated: r.truncated };
  };
}
