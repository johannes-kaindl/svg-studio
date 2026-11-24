// vendored from obsidian-kit@0.108.0, src/obsidian/review-list.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/**
 * Prüfliste: Karten für Änderungen und Kommentare mit Annehmen, Ablehnen, Kommentar, Antworten und Erledigt — der Prüfen-Tab von
 * Diachronic, aber ohne Wissen über CriticMarkup, Notizen oder Editor. Der Baustein bekommt fertige Einträge und meldet Aktionen.
 *
 * ## Herkunft und Abgrenzung
 *
 * Karten mit Aktionen je Eintrag gibt es in mehreren Plugins ohne Kit-Baustein; UI-STANDARD §8 führt „Info-/Ergebnis-Karte“ als
 * Blaupause und „Empty-State“ als verbindlich. Vorbild der Karte ist vault-rag `src/integrator_panel.ts:86` `renderCard` (Annehmen
 * `mod-cta`, Ablehnen, Alle annehmen/ablehnen `:113-116`, Stale-Hinweis `:97`, Doppelklick-Schutz `run()` `:137`); die Begründungszeile
 * folgt settings-assistant `src/obsidian/check-rows-view.ts:46`, die Kartenform vault-crews `src/obsidian/panel.ts:276`. Gelesen, nicht
 * kopiert: Diachronic hat Änderungskarten mit einem Redline-Ausschnitt und Kommentarfäden, die dort keiner kennt. Der Ausschnitt kommt
 * aus `redline` (`renderRedline`); Beschriftungen wie in vault-rag („Annehmen“, „Ablehnen“, „Alle annehmen“, „Alle ablehnen“) übergibt
 * der Aufrufer, das Kit hat kein `t()`.
 *
 * ## Verhalten
 *
 * - **Kopfzeile** mit `openCount(n)` (n = Zahl der Änderungskarten) und den Knöpfen „Alle annehmen“ / „Alle ablehnen“, die Knöpfe nur bei
 *   n > 0. Ohne Einträge steht an ihrer Stelle nur der Leerzustand `div.okit-review-empty` mit `strings.empty`.
 * - **Entscheidungszustand (`decision`, 0.79.0):** `accepted` oder `rejected` an einer Änderung setzt `is-accepted` bzw. `is-rejected` an der Karte, zeigt `strings.decided[decision]` unter der Meta-Zeile und setzt `aria-pressed` an Annehmen und Ablehnen (an beiden, damit ein Screenreader den Zustand liest). Die Knöpfe bleiben bedienbar, eine Entscheidung lässt sich ändern; ohne `decision` bleibt das DOM wie vor 0.79.0.
 * - **Änderungskarte:** Meta-Zeile „Autor · Zeit · Art“, der Ausschnitt über `renderRedline`, die Knöpfe Annehmen (`mod-cta`), Ablehnen und
 *   Kommentar. Bei `stale` stehen der Hinweis `strings.stale` darüber und Annehmen/Ablehnen sind gesperrt (Kommentar bleibt): die Stelle,
 *   auf die sich die Änderung bezieht, gibt es nicht mehr so, und eine Aktion landete am falschen Ort.
 * - **Kommentarkarte:** das Zitat der Stelle (oder `strings.orphan`, wenn `anchorText` `null` ist), der Faden, die Knöpfe Antworten und
 *   Erledigt. Ein erledigter Kommentar (`resolved`) trägt `is-resolved` und ist **eingeklappt**: eine Zeile (Autor und erste Zeile des
 *   ersten Beitrags) und „Wieder öffnen“.
 * - **Klick auf den Kartenrumpf** (alles außer den Knöpfen) löst `jump` aus; der Rumpf ist per Tab erreichbar, Enter und Leertaste
 *   springen ebenso. Der Sprung ist Navigation und nicht gesperrt.
 * - **Eine Aktion zur Zeit, in der ganzen Liste** (Doppelklick-Schutz). Solange ein Handler läuft (er darf ein Promise liefern), sind
 *   **alle** Knöpfe gesperrt (`disabled`, `aria-busy` an der Wurzel) und ein weiterer Aufruf verpufft hart im Handler. Der Grund ist
 *   nicht nur der Doppelklick: jede Aktion schreibt in dieselbe Notiz und verschiebt deren Stellen, eine zweite Karte würde auf einem
 *   Stand arbeiten, den es nicht mehr gibt. Läuft ein Handler fehl, wird die Sperre gelöst; der Fehler geht an `onError`, ohne es
 *   wird er erneut geworfen (nicht verschluckt).
 * - **Das Modul zeichnet nicht neu.** Nach einer Aktion baut der Aufrufer aus dem neuen Zustand eine neue Liste (Elternknoten leeren,
 *   `buildReviewList` erneut) — der Zustand liegt beim Aufrufer, die Liste ist seine Sicht.
 * - **Farbe je Autor** (`colorByAuthor`, Default aus): die Karte bekommt `data-author` und einen Randstreifen in der Farbe des Platzes
 *   (`authorSlot`), der Ausschnitt färbt über `renderRedline`. Der Autor steht immer auch als Text in der Meta-Zeile.
 *
 * - **Kandidatenkarte (Welle 36, kp1c, Bestellung 13 der Design-Linie pseudonymizer, Spec 2026-11-18 § 8.5):** eine Karte je gefundenem Wert, nicht je Stelle. Kopf „Fundtext · Art · N Stellen“,
 *   die Kontextzeile der ersten Stelle mit hervorgehobenem Treffer (`<mark>`, fett: Form, nicht nur Farbe), weitere Stellen hinter „alle zeigen“ (`aria-expanded`), zwei bis vier frei benannte **Wege**
 *   als Segment-Schalter (`buildSegmentedControl`, Pfeiltasten, Roving-Tabindex) und optional die Auswahl „gehört zu“ (ein natives `<select>`: vorhandener Eintrag, neuer Eintrag, niemandem; die
 *   Optionen und die Vorgabe bestimmt der Aufrufer) samt Zeile „auch: …“. Ein Weg- oder Zuordnungswechsel geht an `onWay(id, wayId)` bzw. `onOwner(id, ownerId)`; **das Modul schreibt nichts**, der
 *   Aufrufer merkt sich die Wahl und wendet erst am Ende an („übernehmen“). Beide Wechsel sind keine Aktionen im Sinn von `onAction`: kein neuer Wert in `ReviewAction` (ein Konsument mit
 *   erschöpfendem `switch` über `ReviewAction` bleibt unberührt), keine Sperre der Liste (ein Wechsel hält nicht den Fokus fest). Läuft aber gerade eine asynchrone Aktion, sind Wege und Auswahl
 *   gesperrt. Der Kartenrumpf springt nicht (kein `jump`, keine Rolle `button`): im Prüffenster gibt es keine Stelle, zu der man springt, und ein Schalter im Rumpf risse sonst Enter und
 *   Leertaste an sich. Die Kopfzeile (`openCount`, Alle annehmen/ablehnen) entfällt, wenn die Liste nur Kandidaten trägt; der Aufrufer schreibt seine eigene Zeile („3 neue Fundstellen“).
 *   Die Anführungszeichen um die Kontextzeile sind `opts.quotes` (Vorgabe `„` und `“`; ein englischer Aufrufer reicht `“` und `”` herein). Der Treffer setzt Hintergrund und Schrift ausdrücklich (`--highlight-background` mit dem älteren `--text-highlight-bg` als Rückfall, `--text-normal`) statt des Standard-Gelbs von `mark`.
 *   `strings.candidate` ist Pflicht, sobald ein Kandidat in der Liste steht (sonst wirft der Bau; ein stilles Weglassen der Beschriftung wäre der teurere Fehler). Bestehende Kartenarten
 *   antworten wortgleich (Goldstand `tests/fixtures/review-list-bestand.json`, Test `tests/review-list-bestand.test.ts`). `REVIEW_LIST_CSS` und `SEGMENTED_CONTROL_CSS` gehören beide in die
 *   `styles.css`; Tippflächen der Wege, des Umschalters und der Auswahl sind mindestens 44 px hoch.
 *
 * ## Fallen beim Übernehmen
 *
 * 1. **Das Kit injiziert kein CSS.** `REVIEW_LIST_CSS` gehört in die `styles.css` des Consumers, `REDLINE_CSS` ebenfalls (der Ausschnitt).
 * 2. **`when` ist ein Anzeigetext** vom Aufrufer (lokale Zeit, relative Angabe); das Modul formatiert nichts.
 * 3. **Nur eine Liste je Elternknoten:** der Aufrufer leert ihn, bevor er neu baut.
 */

import { renderRedline, type RedlineSegment } from "./redline";
import { buildSegmentedControl, type SegmentedControl } from "./segmented-control";

export type ReviewAction = "accept" | "reject" | "comment" | "reply" | "resolve" | "reopen" | "jump";

export interface ReviewChange {
  kind: "change";
  id: string;
  author: string;
  /** Anzeigetext der Zeit, vom Aufrufer formatiert. */
  when: string;
  changeKind: "insertion" | "deletion" | "substitution";
  /** Kontext und Änderung, etwa aus `clipContext` und dem Wort-Diff. */
  segments: RedlineSegment[];
  stale?: boolean;
  /** Autoren-Platz 0–5, nur mit `colorByAuthor` wirksam. */
  authorSlot?: number;
  /** Was der Nutzer mit dieser Änderung entschieden hat (K16, 0.79.0). Ohne Wert ist die Karte wie bisher: offen, ohne `aria-pressed`. Der Zustand liegt
   *  beim Aufrufer; die Karte zeigt ihn und lässt die Knöpfe bedienbar, die Entscheidung ist also umkehrbar. */
  decision?: "accepted" | "rejected";
}

export interface ReviewComment {
  kind: "comment";
  id: string;
  /** `null`: verwaist oder ohne Anker. */
  anchorText: string | null;
  thread: Array<{ author: string; when: string; text: string }>;
  resolved: boolean;
}

/** Eine Stelle eines Werts im Text: der Treffer mit dem Text davor und danach (vom Aufrufer gekürzt, etwa mit `clipContext`). */
export interface ReviewCandidatePlace {
  before: string;
  hit: string;
  after: string;
}

/** Ein Weg der Karte (etwa „Ersetzen“, „Hier lassen“, „Immer lassen“): `id` kommt bei `onWay` zurück, `label` ist die Beschriftung des Aufrufers. */
export interface ReviewCandidateWay {
  id: string;
  label: string;
  /** Tooltip am Knopf, etwa was der Weg bewirkt. */
  title?: string;
}

/** Ein Eintrag der Auswahl „gehört zu“. */
export interface ReviewCandidateOwner {
  id: string;
  label: string;
}

export interface ReviewCandidate {
  kind: "candidate";
  id: string;
  /** Der gefundene Wert, wie er im Text steht. */
  found: string;
  /** Anzeigetext der Art („Person“, „Telefon“), vom Aufrufer. */
  type: string;
  /** Die Stellen in Textreihenfolge; die erste steht immer da, die übrigen hinter „alle zeigen“. Mindestens eine. */
  places: readonly ReviewCandidatePlace[];
  /** Zahl der Stellen, wenn der Aufrufer nicht alle mitgibt (Vorgabe: `places.length`). */
  placeCount?: number;
  /** Zwei bis vier Wege. */
  ways: readonly ReviewCandidateWay[];
  /** Der gewählte Weg (`id`); ohne Treffer gilt der erste. */
  way: string;
  /** Die Auswahl „gehört zu“; fehlt sie, entfällt die Zeile. */
  owner?: { options: readonly ReviewCandidateOwner[]; value: string };
  /** „auch: …“, etwa weitere Schreibweisen desselben Eintrags. */
  also?: readonly string[];
}

export type ReviewItem = ReviewChange | ReviewComment | ReviewCandidate;

export interface ReviewCandidateStrings {
  /** „4 Stellen“. */
  places: (n: number) => string;
  /** Knopf, der die übrigen Stellen aufklappt / wieder einklappt. */
  showAll: string;
  hideAll: string;
  /** Beschriftung der Auswahl „gehört zu“. */
  owner: string;
  /** Beschriftung vor der Zeile „auch: …“. */
  also: string;
  /** Name der Gruppe der Wege für Screenreader („Weg für diesen Wert“). */
  waysLabel: string;
}

export interface ReviewListStrings {
  accept: string;
  reject: string;
  comment: string;
  reply: string;
  resolve: string;
  reopen: string;
  acceptAll: string;
  rejectAll: string;
  openCount: (n: number) => string;
  empty: string;
  stale: string;
  orphan: string;
  kind: Record<"insertion" | "deletion" | "substitution", string>;
  /** Anzeigetext einer entschiedenen Karte („Angenommen“, „Abgelehnt“). Fehlt er, tragen Klasse und `aria-pressed` den Zustand, nur der Text entfällt. */
  decided?: Record<"accepted" | "rejected", string>;
  /** Beschriftungen der Kandidatenkarte; Pflicht, sobald die Liste einen Kandidaten trägt. */
  candidate?: ReviewCandidateStrings;
}

export interface ReviewListOptions {
  items: readonly ReviewItem[];
  strings: ReviewListStrings;
  colorByAuthor?: boolean;
  onAction(action: ReviewAction, id: string): void | Promise<void>;
  onBulk(action: "accept-all" | "reject-all"): void | Promise<void>;
  /** Kandidatenkarte: der Nutzer hat einen anderen Weg gewählt. Das Modul schreibt nichts; ein Wurf oder eine Ablehnung geht an `onError` (ohne: erneut geworfen). */
  onWay?(id: string, wayId: string): void | Promise<void>;
  /** Kandidatenkarte: der Nutzer hat „gehört zu“ geändert. */
  onOwner?(id: string, ownerId: string): void | Promise<void>;
  /** Ein Handler hat abgelehnt oder geworfen. Ohne diese Funktion wird der Fehler erneut geworfen. */
  onError?(err: unknown): void;
  /** Kandidatenkarte: die Anführungszeichen um die Kontextzeile. Das Kit ist i18n-frei, der Aufrufer reicht sie je Sprache herein (englisch `{ open: "“", close: "”" }`). Vorgabe: `„` und `“`, wie vor 0.107.0. */
  quotes?: { open: string; close: string };
}

const DEFAULT_QUOTES = { open: "„", close: "“" } as const;

const AUTHOR_SLOTS = 6;

/** Baut die Liste in `parent` und gibt ihre Wurzel zurück. */
export function buildReviewList(parent: HTMLElement, opts: ReviewListOptions): HTMLElement {
  const { items, strings } = opts;
  const quotes = opts.quotes ?? DEFAULT_QUOTES;
  const root = parent.createDiv({ cls: "okit-review" });
  if (items.length === 0) {
    root.createDiv({ cls: "okit-review-empty", text: strings.empty });
    return root;
  }

  // Knöpfe der ganzen Liste: eine Aktion zur Zeit sperrt sie alle.
  const buttons: Array<{ el: HTMLButtonElement; fixed: boolean }> = [];
  // Wege und Auswahlen der Kandidatenkarten: gesperrt nur, solange eine ASYNCHRONE Aktion läuft (ein synchroner Handler soll dem Schalter den Fokus nicht nehmen).
  const choosers: Array<{ lock(on: boolean): void }> = [];
  let pending = false;
  const sync = (): void => {
    for (const b of buttons) b.el.disabled = pending || b.fixed;
    if (pending) root.setAttribute("aria-busy", "true");
    else root.removeAttribute("aria-busy");
  };
  const fail = (err: unknown): void => {
    if (opts.onError) opts.onError(err);
    else throw err;
  };
  // Ein Handler ohne Promise gibt die Sperre sofort wieder frei, einer mit Promise erst, wenn es erfüllt oder abgelehnt ist.
  const run = (fn: () => void | Promise<void>): void => {
    if (pending) return;
    pending = true;
    sync();
    const done = (): void => { pending = false; sync(); };
    let result: void | Promise<void>;
    try {
      result = fn();
    } catch (err) {
      done();
      fail(err);
      return;
    }
    if (result === undefined) { done(); return; }
    for (const c of choosers) c.lock(true);
    const release = (): void => { for (const c of choosers) c.lock(false); done(); };
    void result.then(release, (err: unknown) => { release(); fail(err); });
  };
  const button = (parentEl: HTMLElement, cls: string, text: string, fn: () => void | Promise<void>, fixed = false): HTMLButtonElement => {
    const el = parentEl.createEl("button", { cls, text, attr: { type: "button" } });
    buttons.push({ el, fixed });
    el.disabled = fixed;
    el.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      // Ein dauerhaft gesperrter Knopf (stale) feuert im Browser nicht; das hier hält ein Aufruf von außen genauso ab.
      if (fixed) return;
      run(fn);
    });
    return el;
  };

  const openChanges = items.filter((i) => i.kind === "change").length;
  // Eine Liste nur aus Kandidaten hat keine Änderungen zu zählen: die Kopfzeile „0 offene Änderungen“ entfällt, der Aufrufer schreibt seine eigene.
  if (openChanges > 0 || !items.some((i) => i.kind === "candidate")) {
    const head = root.createDiv({ cls: "okit-review-head" });
    head.createSpan({ cls: "okit-review-count", text: strings.openCount(openChanges) });
    if (openChanges > 0) {
      const bulk = head.createDiv({ cls: "okit-review-bulk" });
      button(bulk, "mod-cta okit-review-accept-all", strings.acceptAll, () => opts.onBulk("accept-all"));
      button(bulk, "okit-review-reject-all", strings.rejectAll, () => opts.onBulk("reject-all"));
    }
  }

  const list = root.createDiv({ cls: "okit-review-items" });
  const act = (action: ReviewAction, id: string) => (): void | Promise<void> => opts.onAction(action, id);

  /** Der Rumpf springt per Klick und Tastatur; er trägt keinen Knopf, deshalb ist die Rolle erlaubt. */
  const main = (card: HTMLElement, id: string): HTMLElement => {
    const el = card.createDiv({ cls: "okit-review-main", attr: { tabindex: "0", role: "button" } });
    el.addEventListener("click", () => { void opts.onAction("jump", id); });
    el.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      void opts.onAction("jump", id);
    });
    return el;
  };

  /** Ein Wechsel (Weg, Zuordnung) geht ohne Sperre an den Aufrufer; ein Fehler geht denselben Weg wie bei den Aktionen. */
  const choose = (fn: () => void | Promise<void>): void => {
    if (pending) return;
    try {
      const r = fn();
      if (r !== undefined) void r.catch((err: unknown) => { fail(err); });
    } catch (err) {
      fail(err);
    }
  };

  for (const item of items) {
    if (item.kind === "candidate") {
      const t = strings.candidate;
      if (!t) throw new Error("buildReviewList: strings.candidate fehlt (nötig für Kandidatenkarten)");
      if (item.places.length === 0) throw new Error(`buildReviewList: der Kandidat ${item.id} hat keine Stelle`);
      const card = list.createDiv({ cls: "okit-review-card is-candidate", attr: { "data-id": item.id } });
      const body = card.createDiv({ cls: "okit-review-body" });
      const meta = body.createDiv({ cls: "okit-review-meta" });
      meta.createSpan({ cls: "okit-review-found", text: item.found });
      meta.createSpan({ cls: "okit-review-sep", text: " · ", attr: { "aria-hidden": "true" } });
      meta.createSpan({ cls: "okit-review-type", text: item.type });
      meta.createSpan({ cls: "okit-review-sep", text: " · ", attr: { "aria-hidden": "true" } });
      meta.createSpan({ cls: "okit-review-places", text: t.places(item.placeCount ?? item.places.length) });
      const context = (host: HTMLElement, place: ReviewCandidatePlace): void => {
        const line = host.createDiv({ cls: "okit-review-context" });
        line.createSpan({ cls: "okit-review-before", text: `${quotes.open}${place.before}` });
        line.createEl("mark", { cls: "okit-review-hit", text: place.hit });
        line.createSpan({ cls: "okit-review-after", text: `${place.after}${quotes.close}` });
      };
      const [first, ...rest] = item.places;
      if (first) context(body, first);
      if (rest.length > 0) {
        const more = body.createDiv({ cls: "okit-review-more" });
        more.hide();
        for (const place of rest) context(more, place);
        let open = false;
        const toggle = body.createEl("button", { cls: "okit-review-toggle", text: t.showAll, attr: { type: "button", "aria-expanded": "false" } });
        toggle.addEventListener("click", () => {
          open = !open;
          toggle.setText(open ? t.hideAll : t.showAll);
          toggle.setAttribute("aria-expanded", String(open));
          if (open) more.show(); else more.hide();
        });
      }
      const ways = card.createDiv({ cls: "okit-review-ways" });
      const wayControl: SegmentedControl = buildSegmentedControl(ways, {
        options: item.ways.map((w) => (w.title === undefined ? { value: w.id, label: w.label } : { value: w.id, label: w.label, title: w.title })),
        value: item.way,
        ariaLabel: t.waysLabel,
        onChange: (value) => { choose(() => opts.onWay?.(item.id, value)); },
      });
      choosers.push({ lock: (on) => { wayControl.setDisabled(on); } });
      if (item.owner) {
        const row = card.createDiv({ cls: "okit-review-owner" });
        const label = row.createEl("label", { cls: "okit-review-owner-label" });
        label.createSpan({ cls: "okit-review-owner-text", text: t.owner });
        const select = label.createEl("select", { cls: "dropdown okit-review-owner-select", attr: { "data-id": item.id } });
        for (const o of item.owner.options) select.createEl("option", { text: o.label, attr: { value: o.id } });
        select.value = item.owner.value;
        select.addEventListener("change", () => { choose(() => opts.onOwner?.(item.id, select.value)); });
        choosers.push({ lock: (on) => { select.disabled = on; } });
      }
      if (item.also && item.also.length > 0) {
        card.createDiv({ cls: "okit-review-also", text: `${t.also}: ${item.also.join(", ")}` });
      }
      continue;
    }
    if (item.kind === "change") {
      const card = list.createDiv({
        cls: item.decision ? `okit-review-card is-change is-${item.decision}` : "okit-review-card is-change",
        attr: { "data-id": item.id },
      });
      if (opts.colorByAuthor && item.authorSlot !== undefined && Number.isInteger(item.authorSlot) && item.authorSlot >= 0 && item.authorSlot < AUTHOR_SLOTS) {
        card.setAttribute("data-author", String(item.authorSlot));
      }
      const body = main(card, item.id);
      if (item.stale) body.createDiv({ cls: "okit-review-stale", text: strings.stale });
      const meta = body.createDiv({ cls: "okit-review-meta" });
      meta.createSpan({ cls: "okit-review-author", text: item.author });
      meta.createSpan({ cls: "okit-review-sep", text: " · ", attr: { "aria-hidden": "true" } });
      meta.createSpan({ cls: "okit-review-when", text: item.when });
      meta.createSpan({ cls: "okit-review-sep", text: " · ", attr: { "aria-hidden": "true" } });
      meta.createSpan({ cls: "okit-review-kind", text: strings.kind[item.changeKind] });
      if (item.decision && strings.decided) body.createDiv({ cls: "okit-review-decided", text: strings.decided[item.decision] });
      renderRedline(body, item.segments, {
        colorByAuthor: opts.colorByAuthor === true,
        labels: { del: strings.kind.deletion, ins: strings.kind.insertion },
      });
      const actions = card.createDiv({ cls: "okit-review-actions" });
      const stale = item.stale === true;
      const acceptBtn = button(actions, "mod-cta okit-review-accept", strings.accept, act("accept", item.id), stale);
      const rejectBtn = button(actions, "okit-review-reject", strings.reject, act("reject", item.id), stale);
      if (item.decision) {
        acceptBtn.setAttribute("aria-pressed", String(item.decision === "accepted"));
        rejectBtn.setAttribute("aria-pressed", String(item.decision === "rejected"));
      }
      button(actions, "okit-review-comment", strings.comment, act("comment", item.id));
      continue;
    }

    const card = list.createDiv({ cls: item.resolved ? "okit-review-card is-comment is-resolved" : "okit-review-card is-comment", attr: { "data-id": item.id } });
    const body = main(card, item.id);
    if (item.resolved) {
      const first = item.thread[0];
      const line = first ? `${first.author}: ${first.text.split("\n")[0] ?? ""}` : "";
      body.createDiv({ cls: "okit-review-summary", text: line });
      button(card.createDiv({ cls: "okit-review-actions" }), "okit-review-reopen", strings.reopen, act("reopen", item.id));
      continue;
    }
    if (item.anchorText === null) body.createDiv({ cls: "okit-review-orphan", text: strings.orphan });
    else body.createDiv({ cls: "okit-review-anchor", text: item.anchorText });
    const thread = body.createDiv({ cls: "okit-review-thread" });
    for (const entry of item.thread) {
      const row = thread.createDiv({ cls: "okit-review-entry" });
      const meta = row.createDiv({ cls: "okit-review-meta" });
      meta.createSpan({ cls: "okit-review-author", text: entry.author });
      meta.createSpan({ cls: "okit-review-sep", text: " · ", attr: { "aria-hidden": "true" } });
      meta.createSpan({ cls: "okit-review-when", text: entry.when });
      row.createDiv({ cls: "okit-review-text", text: entry.text });
    }
    const actions = card.createDiv({ cls: "okit-review-actions" });
    button(actions, "mod-cta okit-review-reply", strings.reply, act("reply", item.id));
    button(actions, "okit-review-resolve", strings.resolve, act("resolve", item.id));
  }
  return root;
}

/** Gehört in die `styles.css` des Consumers — das Kit injiziert kein CSS. Nur Theme-Variablen. */
export const REVIEW_LIST_CSS = `
.okit-review {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.okit-review[aria-busy="true"] {
  cursor: progress;
}

.okit-review-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
}

.okit-review-count {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}

.okit-review-bulk,
.okit-review-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-3);
}

.okit-review-items {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.okit-review-card {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
  background-color: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
}

.okit-review-card.is-resolved {
  color: var(--text-faint);
}

.okit-review-card.is-accepted {
  border-color: var(--interactive-accent);
}

.okit-review-card.is-rejected {
  color: var(--text-muted);
  border-style: dashed;
}

.okit-review-decided {
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
}

.okit-review-card.is-accepted .okit-review-decided {
  color: var(--text-accent);
}

.okit-review-main {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-3);
  cursor: pointer;
  border-radius: var(--radius-s);
}

.okit-review-main:focus-visible {
  box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
}

.okit-review-meta {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}

.okit-review-stale {
  font-size: var(--font-ui-smaller);
  color: var(--text-warning);
}

.okit-review-anchor {
  padding-inline-start: var(--size-4-2);
  border-inline-start: 2px solid var(--background-modifier-border);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}

.okit-review-orphan {
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
}

.okit-review-thread {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.okit-review-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-ui-small);
}

.okit-review-summary {
  font-size: var(--font-ui-small);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.okit-review-actions button {
  flex: 1 1 auto;
  min-height: var(--input-height);
}

.okit-review-empty {
  padding: var(--size-4-4);
  text-align: center;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.okit-review-body {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-3);
}

.okit-review-found {
  font-weight: var(--font-semibold);
  color: var(--text-normal);
  overflow-wrap: anywhere;
}

.okit-review-context {
  padding-inline-start: var(--size-4-2);
  border-inline-start: 2px solid var(--background-modifier-border);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}

.okit-review-hit {
  background-color: var(--highlight-background, var(--text-highlight-bg));
  font-weight: var(--font-semibold);
  color: var(--text-normal);
  border-bottom: 1px solid currentcolor;
}

.okit-review-more {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-3);
}

.okit-review-toggle {
  align-self: flex-start;
  min-height: calc(var(--size-4-10) + var(--size-4-1));
}

.okit-review-ways .okit-segmented {
  display: flex;
  width: 100%;
}

.okit-review-ways .okit-segmented-btn {
  flex: 1 1 auto;
  min-height: calc(var(--size-4-10) + var(--size-4-1));
}

.okit-review-owner-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
}

.okit-review-owner-select {
  flex: 1 1 auto;
  min-height: calc(var(--size-4-10) + var(--size-4-1));
  min-width: 0;
}

.okit-review-also {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.okit-review-card[data-author="0"] { border-inline-start: 3px solid var(--color-blue); }
.okit-review-card[data-author="1"] { border-inline-start: 3px solid var(--color-orange); }
.okit-review-card[data-author="2"] { border-inline-start: 3px solid var(--color-purple); }
.okit-review-card[data-author="3"] { border-inline-start: 3px solid var(--color-cyan); }
.okit-review-card[data-author="4"] { border-inline-start: 3px solid var(--color-yellow); }
.okit-review-card[data-author="5"] { border-inline-start: 3px solid var(--color-pink); }
`;
