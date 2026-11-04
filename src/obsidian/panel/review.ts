// Die Prüfliste (Spec § 7.2 Punkt 4, Plan 2 D1) auf dem Kit-Baustein `review-list`: die Einträge der aktiven Runde als Karten mit Annehmen und Ablehnen, einem Redline
// je Karte (Wort-Diff alt → neu) und „Alle annehmen / Alle ablehnen“. Vorgabe ist angenommen (E3); jede Entscheidung läuft über `decide` und ersetzt die Sitzung, die
// Vorschau zeigt danach das Ergebnis ohne den abgelehnten Eintrag. Karten einer Runde, auf der eine spätere aufbaut, sind gesperrt (`stale`).
// Eine `whole`-Runde („nicht zerlegbar“, Reparatur eines unlesbaren Bestands) ist EINE Karte mit zwei kleinen Vorschauen Vorher/Nachher, ganz annehmbar oder ablehnbar.
// Eine Regelrunde (Namen vergeben, Editor-Angaben entfernen) hat nichts zu entscheiden: sie zeigt ihre Änderungen als Redline-Zeilen.
// Der Kommentar (seit obsidian-kit 0.80.0): die Taste der Karte öffnet `promptText` (mehrzeilig, nicht leer), das Ergebnis wird `Decision.comment` des Eintrags (der Zustand,
// angenommen oder abgelehnt, bleibt), die Karte zeigt ihn unter dem Redline, und `feedbackOf` reicht ihn in die nächste Verfeinern-Anfrage. Das Kit zeigt an einer Änderungskarte
// keinen Kommentar, deshalb zeichnet dieses Modul ihn selbst. Eine Runde „ganzes Bild“ speichert nur den Zustand: dort entfällt die Taste.
import { backgroundColor } from "../../core/background";
import { describeEntry } from "../../core/diff-labels";
import type { Problem } from "../../core/problem";
import { diffSvg } from "../../core/diff";
import { baseTextOfRound, decide, type Decision, type SvgRound, type SvgSession } from "../../core/session";
import { labelTexts, problemText, t } from "../../i18n/strings";
import { checkSvg } from "../../vendor/kit/svg-guard";
import { renderRedline } from "../../vendor/kit-obsidian/redline";
import { buildReviewList, type ReviewChange, type ReviewListStrings } from "../../vendor/kit-obsidian/review-list";
import { buildPreview } from "./preview";
import type { PreviewViewDeps } from "./preview-view";
import type { ChangesCtx } from "./shell";

/** Gestrichener und eingefügter Wert stehen im Redline sonst ohne Trennung nebeneinander („x 165145“): ein Pfeil dazwischen (GUI-Smoke D3). Nur Darstellung, die Segmente des Diffs bleiben, wie sie sind. */
function withArrows<S extends { kind: string; text: string }>(segs: readonly S[]): S[] {
  return segs.flatMap((seg, i): S[] => (seg.kind === "ins" && segs[i - 1]?.kind === "del" ? [{ ...seg, kind: "same", text: " → " }, seg] : [seg]));
}

export interface ReviewDeps {
  /** Hintergrund der kleinen Vorschauen (dieselbe Wahl wie die große Vorschau). */
  background: PreviewViewDeps["background"];
  /** Die große Vorschau springt zu diesem Element (Klick auf den Kartenrumpf). */
  jump: (id: string) => void;
  /** Fragt den Kommentartext (mit dem bisherigen als Vorbelegung); `null` heißt Abbruch. Fehlt die Funktion, gibt es keine Kommentar-Taste. */
  comment?: (initial: string) => Promise<string | null>;
}

/** Die Texte des Kit-Bausteins in der Sprache des Plugins (nur hier gebraucht, deshalb nicht exportiert). */
function reviewStrings(): ReviewListStrings {
  return {
    accept: t("review.accept"),
    reject: t("review.reject"),
    comment: t("review.comment"),
    reply: t("review.reply"),
    resolve: t("review.resolve"),
    reopen: t("review.reopen"),
    acceptAll: t("review.acceptAll"),
    rejectAll: t("review.rejectAll"),
    openCount: (n) => t("review.open", n),
    empty: t("review.empty"),
    stale: t("review.stale"),
    orphan: t("review.orphan"),
    kind: { insertion: t("review.kind.insertion"), deletion: t("review.kind.deletion"), substitution: t("review.kind.substitution") },
    decided: { accepted: t("review.decided.accepted"), rejected: t("review.decided.rejected") },
  };
}

/** Wie viele Einträge eine Runde zur Entscheidung hat (`whole`: einer, Regelrunde: keiner). */
function entryCount(r: SvgRound): number {
  return r.body.form === "list" ? r.body.entries.length : r.body.form === "whole" ? 1 : 0;
}

/** Die bisherige Entscheidung eines Eintrags (Kommentar bleibt beim Umentscheiden). */
function decisionOf(r: SvgRound, entry: number): Decision {
  const b = r.body;
  if (b.form === "list") return b.decisions[entry] ?? { state: "accepted" };
  if (b.form === "whole") return { state: b.decision };
  return { state: "accepted" };
}

export function renderReview(host: HTMLElement, round: SvgRound | null, session: SvgSession, ctx: ChangesCtx<SvgSession>, d: ReviewDeps): void {
  if (round === null) return;
  const index = session.rounds.active;
  if (round.body.form === "rule") {
    renderRule(host, round, session);
    return;
  }
  const texts = labelTexts();
  const before = baseTextOfRound(session, round);
  // Ein neues SVG (Erzeugen) hat kein Vorher: es gibt nichts, was „ersetzt“ würde.
  if (round.body.form === "whole" && before === null) return;
  const stale = session.rounds.rounds.some((x) => x.basedOn === index);
  const author = t(round.art === "hand" ? "review.author.hand" : "review.author.model");
  const when = t("review.round", index + 1);
  const b = round.body;

  const items: ReviewChange[] =
    b.form === "list"
      ? b.entries.map((e, i): ReviewChange => {
          const text = describeEntry(e, texts);
          return { kind: "change", id: String(i), author, when, changeKind: text.changeKind, segments: withArrows(text.segments), stale, decision: decisionOf(round, i).state };
        })
      : [{
          kind: "change", id: "0", author, when, changeKind: "substitution", stale, decision: b.decision,
          segments: [{ kind: "same", text: t(round.art === "repair" ? "review.wholeRepair" : "review.whole") }],
        }];

  const decideEntry = (s: SvgSession, entry: number, state: Decision["state"]): SvgSession | { problem: Problem } =>
    decide(s, index, entry, { ...decisionOf(s.rounds.rounds[index] ?? round, entry), state });
  const fail = (p: Problem): void => { ctx.setStatus("error", t("review.failed", problemText(p))); };

  /** Der Kommentar-Dialog; der Kit-Baustein hält die ganze Liste gesperrt, bis er sich schließt. Der Zustand der Karte bleibt, nur der Kommentar kommt dazu. */
  const askComment = async (entry: number): Promise<void> => {
    if (d.comment === undefined) return;
    const text = await d.comment(decisionOf(ctx.session().rounds.rounds[index] ?? round, entry).comment ?? "");
    if (text === null || ctx.busy()) return;
    const now = ctx.session();
    const next = decide(now, index, entry, { ...decisionOf(now.rounds.rounds[index] ?? round, entry), comment: text });
    if ("problem" in next) fail(next.problem);
    else ctx.setSession(next);
  };

  const root = buildReviewList(host, {
    items,
    strings: reviewStrings(),
    onAction: (action, id) => {
      if (ctx.busy()) return;
      const entry = Number(id);
      if (action === "comment") return askComment(entry);
      if (action === "jump") {
        const e = b.form === "list" ? b.entries[entry] : undefined;
        const target = e === undefined ? null : describeEntry(e, texts).jumpId;
        if (target !== null) d.jump(target);
        return;
      }
      if (action !== "accept" && action !== "reject") return;
      const next = decideEntry(ctx.session(), entry, action === "accept" ? "accepted" : "rejected");
      if ("problem" in next) fail(next.problem);
      else ctx.setSession(next);
    },
    onBulk: (action) => {
      if (ctx.busy()) return;
      // Alles oder nichts: scheitert ein Eintrag, bleibt die Sitzung wie sie war.
      let next = ctx.session();
      for (let i = 0; i < entryCount(round); i++) {
        const r = decideEntry(next, i, action === "accept-all" ? "accepted" : "rejected");
        if ("problem" in r) { fail(r.problem); return; }
        next = r;
      }
      ctx.setSession(next);
    },
    onError: (e) => { ctx.setStatus("error", t("review.failed", e instanceof Error ? e.message : String(e))); },
  });
  root.addClass("svg-studio-review");
  // Ohne Dialog, in einer Runde „ganzes Bild“ (sie hält nur den Zustand) und hinter einer späteren Runde (`decide` sperrt sie) gibt es keine Kommentar-Taste.
  if (d.comment === undefined || b.form !== "list" || stale) for (const btn of Array.from(root.querySelectorAll(".okit-review-comment"))) btn.remove();
  if (b.form === "list") {
    b.decisions.forEach((dec, i) => {
      const comment = dec.comment?.trim();
      if (comment === undefined || comment === "") return;
      const main = root.querySelector<HTMLElement>(`.okit-review-card[data-id="${i}"] .okit-review-main`);
      if (main === null) return;
      const line = main.createDiv({ cls: "svg-studio-card-comment" });
      line.createSpan({ cls: "svg-studio-card-comment-label", text: `${t("review.commentLabel")}: ` });
      line.createSpan({ text: comment });
    });
  }
  // Der Kit-Baustein sperrt gesperrte Karten, aber nicht „Alle …“: hinter einer späteren Runde gäbe es nur die Meldung „gesperrt“.
  if (stale) for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>(".okit-review-bulk button"))) btn.disabled = true;
  if (b.form === "whole" && before !== null) {
    const main = root.querySelector<HTMLElement>(".okit-review-main");
    if (main !== null) renderCompare(main, before, b.text, d);
  }
}

/** Zwei kleine Vorschauen Vorher/Nachher (die Vorschau aus C3, ohne Zahlenfelder und Regler). Was der Bereiniger ablehnt, zeigt nur den Hinweis. */
function renderCompare(parent: HTMLElement, before: string, after: string, d: ReviewDeps): void {
  const grid = parent.createDiv({ cls: "svg-studio-compare" });
  for (const [label, text] of [[t("review.before"), before], [t("review.after"), after]] as const) {
    const cell = grid.createDiv({ cls: "svg-studio-compare-cell" });
    cell.createDiv({ cls: "svg-studio-compare-label", text: label });
    const preview = buildPreview(cell, { guard: checkSvg, onSelect: () => undefined });
    if (preview.show(text).ok) preview.setBackground(backgroundColor(d.background.get()));
    else {
      preview.destroy();
      cell.createDiv({ cls: "svg-studio-compare-none", text: t("review.notShown") });
    }
  }
}

/** Eine Regelrunde: was die Regel ändert, als Redline-Zeilen (ohne Annehmen und Ablehnen: die Regel gilt ganz, verworfen wird die Runde). */
function renderRule(host: HTMLElement, round: SvgRound, session: SvgSession): void {
  const before = baseTextOfRound(session, round);
  if (before === null) return;
  const box = host.createDiv({ cls: "svg-studio-rule" });
  box.createDiv({ cls: "svg-studio-rule-head", text: t("review.ruleHead") });
  const diff = diffSvg(before, round.result);
  if (!diff.decomposable) {
    box.createDiv({ cls: "svg-studio-rule-line", text: t("review.whole") });
    return;
  }
  const texts = labelTexts();
  for (const e of diff.entries) renderRedline(box.createDiv({ cls: "svg-studio-rule-line" }), withArrows(describeEntry(e, texts).segments));
}
