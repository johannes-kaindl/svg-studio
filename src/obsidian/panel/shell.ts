// Panel-Kern, FORMATNEUTRAL: Kopf (Ziel, Modellzeile, Messzeile), Prompt, Antwortbereich mit Status und Abbruch, Vorschau- und Änderungsplatz, Runden, Fuß.
// Er kennt kein SVG. Alles Formatgebundene kommt über `PanelSlots` herein (Vorschau, Änderungen, Beschriftung der Runde, Messzeile, der Lauf selbst);
// das sind die Nähte der späteren Kit-Task K9 (Plan 2, Tabelle „Kit-Bausteine“: erst nach dem ersten echten SVG-Panel heben).
// Vorlage ist `3d-codeblocks/src/obsidian/prompt-panel.ts`; die Sitzung (`PanelSession` aus dem Kit) und der Lauf (`RunSlot`, ein Lauf zur Zeit) liegen hier.
import type { App } from "obsidian";
import { sameTarget, taskKind, type PanelSession, type Target } from "../../vendor/kit/panel-session";
import { selectRound } from "../../vendor/kit/rounds";
import { createRunSlot, type Run } from "../../vendor/kit/run-slot";
import { markChatHost } from "../../vendor/kit-obsidian/chat-host";
import type { LlmConnection } from "../../vendor/kit-obsidian/llm-connection";
import { buildModelBar, type ModelBar } from "../../vendor/kit-obsidian/model-bar";
import type { AcceptOutcome } from "../../vendor/kit-obsidian/panel-accept";
import { buildStatus, paintStatus, type StatusPhase } from "../../vendor/kit-obsidian/status-indicator";
import { buildStreamArea, type StreamArea } from "../../vendor/kit-obsidian/stream-area";
import { thinkingLevelTexts, thinkingOffTexts, type ThinkingControlOptions } from "../../vendor/kit-obsidian/thinking-control";
import { buildVersionList } from "../../vendor/kit-obsidian/version-list";

export type Task = "create" | "refine";

/** Alle Oberflächentexte des Kerns; `src/i18n/strings.ts` baut sie (`panelStrings()`), damit der Kern keine Sprache festschreibt. */
export interface PanelStrings {
  lang: "en" | "de";
  targetNew: string;
  targetEdit(label: string): string;
  targetKept(label: string): string;
  newButton: string;
  modelLabel: string;
  promptLabel: string;
  placeholderCreate: string;
  placeholderRefine: string;
  create: string;
  refine: string;
  stop: string;
  accept: string;
  discard: string;
  rounds: string;
  reasoning: string;
  copyReasoning: string;
  running(model: string): string;
  aborted: string;
  noEndpoint: string;
  openSettings: string;
  emptyText: string;
  examples: readonly string[];
  previewOf(n: number): string;
  previewNone: string;
  unsupported(label: string): string;
  discardConfirm(n: number): string;
  closeConfirm(n: number): string;
  confirmDiscard: string;
  confirmKeep: string;
  thinkingOff: string;
  thinkingOn(level: string): string;
  thinkingPicker: string;
}

export interface PanelDeps<S extends PanelSession<unknown> = PanelSession<unknown>> {
  app: App;
  llm: LlmConnection;
  /** Zustand und Schalter der Denk-Steuerung in der Modellzeile (ohne Texte). */
  thinking: Pick<ThinkingControlOptions, "family" | "backend" | "current" | "onLevel" | "setLevel" | "levelPicker">;
  /** Aktueller Text des Ziels; `null`: das Ziel ist weg (oder es gibt keinen, beim neuen SVG). */
  readTargetText: (t: Target) => Promise<string | null>;
  /** Übernehmen (Verdrahtung in C4). Bekommt die Sitzung, die der Kern hält. */
  accept(session: S): Promise<AcceptOutcome>;
  /** Der Grund, aus dem Übernehmen jetzt nicht geht (gesperrter Knopf, Grund sichtbar daneben), sonst `null`. Neu bewertet bei jedem Zeichnen und bei `refreshAccept()`. */
  acceptBlockedReason?: (session: S) => string | null;
  openSettings(): void;
  confirm(message: string, labels: { confirm: string; cancel: string }): Promise<boolean>;
  managerPresent(): boolean;
  strings: PanelStrings;
}

/** Was der Lauf dem Kern zurückmeldet. Der Lauf selbst (Anfrage, Prüfung, Rückfrage, Runde) ist formatgebunden und kommt als Slot. */
export type RunResult<S> =
  | { ok: true; session: S; message: string }
  | { ok: false; kind: "aborted" }
  | { ok: false; kind: "no-endpoint"; detail: string }
  | { ok: false; kind: "error"; message: string };

/** Die Hände des Laufs am Panel. Jeder Aufruf ist wirkungslos, sobald der Lauf abgebrochen oder abgelöst ist. */
export interface RunIo {
  /** Der Lauf fragt jetzt: Antwortbereich leeren, Status „Frage {Modell} …“. */
  start: () => void;
  /** Neuer Versuch (Rückfrage): Antwortbereich leeren. */
  clearAnswer: () => void;
  onToken: (text: string) => void;
  onReasoning: (text: string) => void;
  onContentReset: () => void;
  setStatus: (phase: StatusPhase, text: string) => void;
}

export interface RunCall<S> {
  session: S;
  instruction: string;
  signal: AbortSignal;
  /** Das Modell, das fragt (für Statuszeilen und Hinweise). */
  model: string;
  io: RunIo;
}

/** Die formatgebundenen Teile; `R` ist die Runde des Formats, `S` seine Sitzung. */
export interface PanelSlots<R, S extends PanelSession<R> = PanelSession<R>> {
  /** Eine leere Sitzung für ein Ziel (beim Start, bei Verwerfen und Neu). */
  fresh(target: Target): S;
  renderPreview(host: HTMLElement, round: R | null, text: string | null): void;
  /** Die Änderungen der aktiven Runde; die Sitzung gibt den Ausgang, gegen den eine Regelrunde ihre Einträge zeigt. */
  renderChanges(host: HTMLElement, round: R | null, session: S): void;
  roundLabel(round: R, index: number): string;
  roundMeta(round: R): string;
  /** Der Text nach dieser Runde (Vorschau). */
  roundText(round: R): string;
  quality(model: string, task: Task): { measured: boolean; text: string };
  /** Der Lauf: Anfrage, Prüfung, Rückfrage, neue Runde. Wirft nicht; Fehler kommen als `RunResult`. */
  run(call: RunCall<S>): Promise<RunResult<S>>;
  /** Hinweise zum Text, auf dem die Sitzung steht (Bestand: kaputt, ohne Namen, Editor-Angaben), mit Knöpfen, die über `ctx` eine Regelrunde setzen oder einen Lauf starten.
   *  Wird bei jedem Zeichnen mit leerem `host` gerufen; `ctx.current()` sagt, ob das Zeichnen noch gilt (der Slot darf asynchron lesen). */
  notices?(host: HTMLElement, ctx: NoticeCtx<S>): void;
  extras?(host: HTMLElement): void;
  dispose?(): void;
}

/** Was ein Hinweis am Panel tun darf. */
export interface NoticeCtx<S> {
  /** Gilt dieses Zeichnen noch? Nach `await` prüfen, bevor der Host beschrieben wird. */
  current: () => boolean;
  /** Läuft gerade ein Lauf oder Übernehmen? Dann sind Knöpfe gesperrt. */
  busy: () => boolean;
  session: () => S;
  /** Die Sitzung ersetzen (eine lokale Regelrunde) und neu zeichnen; im Lauf und beim Übernehmen wirkungslos. */
  setSession: (s: S) => void;
  /** Einen Lauf mit eigener Anfrage starten (gleiche Sperre, gleicher Abbruch wie das Senden). */
  run: (instruction: string, exec: (call: RunCall<S>) => Promise<RunResult<S>>) => void;
  setStatus: (phase: StatusPhase, text: string) => void;
}

export interface PanelShell<S> {
  setStatus(phase: StatusPhase, text: string): void;
  renderAll(): void;
  /** Das Ziel anbieten: ohne offene Runden gilt es sofort, sonst bleibt das alte (festgehalten) und das neue wartet auf „Verwerfen“. */
  setTarget(target: Target): void;
  session(): S;
  running(): boolean;
  /** Testnaht und Abschluss: wartet auf den laufenden Lauf bzw. Übernehmen. */
  settled(): Promise<void>;
  /** Vor dem Schließen: offene Runden fragen per Bestätigung (`true` = schließen und verwerfen, `false` = behalten). Ein laufender Lauf wird abgebrochen. */
  requestClose(): Promise<boolean>;
  /** Zeichnet die Modellzeile samt Denk-Steuerung aus dem Zustand neu (ohne Abruf). */
  refreshModelBar(): void;
  /** Wertet die Sperre von Übernehmen neu aus (die zuletzt aktive Notiz hat gewechselt). */
  refreshAccept(): void;
  /** Lädt die Modell-Liste der Zeile neu (der Endpunkt oder der Manager haben gewechselt). */
  reloadModels(): void;
  destroy(): void;
}

export function buildPanelShell<R, S extends PanelSession<R>>(root: HTMLElement, deps: PanelDeps<S>, slots: PanelSlots<R, S>, initial?: S): PanelShell<S> {
  const st = deps.strings;
  let session: S = initial ?? slots.fresh({ kind: "new" });
  /** Ein angebotenes, aber nicht übernommenes Ziel: „Verwerfen“ wechselt dorthin. */
  let offered: Target | null = null;
  let kept = false;
  let noEndpoint = false;
  /** Während Übernehmen läuft, sind Übernehmen, Verwerfen, Neu und Senden gesperrt (ein Doppelklick schriebe doppelt). */
  let applying = false;
  let pending: Promise<void> = Promise.resolve();
  let destroyed = false;
  const slot = createRunSlot();

  const panelEl = root.createDiv({ cls: "svg-studio-shell" });
  const offChatHost = markChatHost(root);

  // ---- Kopf ----------------------------------------------------------------------------------
  const top = panelEl.createDiv({ cls: "svg-studio-top" });
  const targetEl = top.createDiv({ cls: "svg-studio-target" });
  const newBtn = top.createEl("button", { cls: "svg-studio-new", text: st.newButton, attr: { type: "button" } });
  const hintEl = panelEl.createDiv({ cls: "svg-studio-hint" });

  const modelBar: ModelBar = buildModelBar({
    app: deps.app,
    containerEl: panelEl,
    llm: deps.llm,
    label: st.modelLabel,
    strings: { lang: st.lang },
    // Während einer Anfrage und während Übernehmen läuft ein Modellwechsel ins Leere.
    disabled: () => slot.running() || applying,
    onChange: () => { renderHeader(); },
    // Ein früher gemeldetes „kein Endpunkt“ gilt nicht für immer: eine erreichbare Liste nimmt es zurück.
    onRefreshed: (r) => { if (r.reachable) noEndpoint = false; renderHeader(); },
    onError: (e) => { if (!slot.running()) setStatus("error", e instanceof Error ? e.message : String(e)); },
    thinking: {
      ...deps.thinking,
      strings: {
        button: (level) => (level === "off" ? st.thinkingOff : st.thinkingOn(thinkingLevelTexts(st.lang).level(level))),
        offNotPossible: thinkingOffTexts(st.lang),
        ...thinkingLevelTexts(st.lang),
        pickerLabel: st.thinkingPicker,
      },
    },
  });

  const quality = buildStatus(panelEl, "svg-studio-quality", { idleIcon: null });
  const noticesHost = panelEl.createDiv({ cls: "svg-studio-notices" });

  // Kein Eingabefeld-Ersatz ohne Endpunkt: der Empty-State steht daneben, das Feld bleibt.
  const noEndpointEl = panelEl.createDiv({ cls: "svg-studio-empty-endpoint is-hidden" });
  noEndpointEl.createDiv({ text: st.noEndpoint });
  const noEndpointDetail = noEndpointEl.createDiv({ cls: "svg-studio-empty-detail" });
  noEndpointEl.createEl("button", { text: st.openSettings, attr: { type: "button" } }).addEventListener("click", () => { deps.openSettings(); });

  const examplesEl = panelEl.createDiv({ cls: "svg-studio-empty is-hidden" });
  examplesEl.createDiv({ text: st.emptyText });

  const input = panelEl.createEl("textarea", { cls: "svg-studio-input", attr: { rows: "4", "aria-label": st.promptLabel } });
  for (const text of st.examples) {
    const b = examplesEl.createEl("button", { cls: "svg-studio-example", text, attr: { type: "button" } });
    b.addEventListener("click", () => { input.value = text; input.focus(); });
  }
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
    }
  });

  const actions = panelEl.createDiv({ cls: "svg-studio-actions" });
  const sendBtn = actions.createEl("button", { cls: "mod-cta svg-studio-send", attr: { type: "button" } });
  sendBtn.addEventListener("click", () => { void run(); });
  const stopBtn = actions.createEl("button", { cls: "svg-studio-stop is-hidden", text: st.stop, attr: { type: "button" } });
  stopBtn.addEventListener("click", () => { stop(); });

  const area: StreamArea = buildStreamArea(panelEl, { strings: { reasoning: st.reasoning, copyReasoning: st.copyReasoning }, cls: "svg-studio-stream" });
  area.statusEl.setAttribute("aria-live", "polite");
  const status = buildStatus(area.statusEl, "svg-studio-status");

  const previewWrap = panelEl.createDiv({ cls: "svg-studio-preview is-hidden" });
  const previewCaption = previewWrap.createDiv({ cls: "svg-studio-preview-caption" });
  const previewHost = previewWrap.createDiv({ cls: "svg-studio-preview-host" });
  const changesHost = panelEl.createDiv({ cls: "svg-studio-changes" });
  const roundsEl = panelEl.createDiv({ cls: "svg-studio-rounds" });
  slots.extras?.(panelEl.createDiv({ cls: "svg-studio-extras" }));

  const acceptHint = panelEl.createDiv({ cls: "svg-studio-accept-hint", attr: { id: "svg-studio-accept-hint" } });
  const end = panelEl.createDiv({ cls: "svg-studio-actions svg-studio-end" });
  const acceptBtn = end.createEl("button", { cls: "mod-cta svg-studio-accept", text: st.accept, attr: { type: "button" } });
  acceptBtn.addEventListener("click", () => { void apply(); });
  const discardBtn = end.createEl("button", { cls: "svg-studio-discard", text: st.discard, attr: { type: "button" } });
  discardBtn.addEventListener("click", () => { void discard(); });
  newBtn.addEventListener("click", () => { void startNew(); });

  // ---- Zustand -------------------------------------------------------------------------------
  const roundCount = (): number => session.rounds.rounds.length;
  const activeRound = (): R | null => (session.rounds.active >= 0 ? (session.rounds.rounds[session.rounds.active] ?? null) : null);
  const model = (): string => {
    const s = deps.llm.source();
    return s.sentModel || s.model;
  };
  function setStatus(phase: StatusPhase, text: string): void {
    paintStatus(status, phase, text);
  }
  const canSend = (): boolean =>
    // `noEndpoint` sperrt NICHT: der Zustand wird vor jedem Senden neu bewertet, sonst wäre der Empty-State eine Sackgasse.
    !slot.running() && !applying && session.target.kind !== "other";

  // ---- Lauf ----------------------------------------------------------------------------------
  function run(): Promise<void> {
    if (!canSend()) return pending;
    const instruction = input.value.trim();
    if (instruction === "") return pending;
    // Genau ein Lauf: `begin()` ohne `supersede` gibt während eines Laufs `null`.
    const r = slot.begin();
    if (r === null) return pending;
    pending = runInner(instruction, r, (call) => slots.run(call));
    return pending;
  }

  /** Ein Lauf, den ein Hinweis anstößt (etwa die Reparatur): gleiche Sperre, gleicher Abbruch, gleiche Anzeige wie das Senden. */
  function runAction(instruction: string, exec: (call: RunCall<S>) => Promise<RunResult<S>>): void {
    if (!canSend()) return;
    const r = slot.begin();
    if (r === null) return;
    pending = runInner(instruction, r, exec);
  }

  async function runInner(instruction: string, r: Run, exec: (call: RunCall<S>) => Promise<RunResult<S>>): Promise<void> {
    noEndpoint = false;
    let streamed = "";
    const io: RunIo = {
      start: () => { r.guard(() => { area.reset(); setStatus("checking", st.running(model())); renderControls(); }); },
      clearAnswer: () => { r.guard(() => { area.reset(); streamed = ""; }); },
      onToken: (text) => { r.guard(() => { streamed += text; area.setTail(streamed); area.followTail(); }); },
      onReasoning: (text) => { r.guard(() => { area.appendReasoning(text); }); },
      // Gemma 4 schreibt sein Denken ohne Öffner in den Inhalt: der bisherige Text war Denken.
      onContentReset: () => { r.guard(() => { streamed = ""; area.setTail(""); }); },
      setStatus: (phase, text) => { r.guard(() => { setStatus(phase, text); }); },
    };
    try {
      renderControls();
      const res = await exec({ session, instruction, signal: r.signal, model: model(), io });
      r.guard(() => {
        if (res.ok) {
          session = res.session;
          // Die Runde und die Vorschau zeigen das Ergebnis; der rohe Quelltext der Antwort schöbe die Vorschau nur nach unten. Bei Misserfolg bleibt er stehen (kein Ergebnis, der Nutzer sieht, was kam).
          area.resetContent();
          area.setReasoningOpen(false);
          setStatus("ok", res.message);
        } else if (res.kind === "aborted") {
          setStatus("idle", st.aborted);
        } else if (res.kind === "no-endpoint") {
          noEndpoint = true;
          noEndpointDetail.setText(res.detail);
          setStatus("error", st.noEndpoint);
        } else {
          setStatus("error", res.message);
        }
      });
    } catch (e) {
      // Das Panel darf nie hängen: jede Ausnahme wird Status.
      r.guard(() => { setStatus("error", e instanceof Error ? e.message : String(e)); });
    } finally {
      r.finish();
      if (!destroyed && !slot.running()) {
        settle();
        renderAll();
        input.focus();
      }
    }
  }

  function stop(): void {
    if (!slot.running()) return;
    slot.abort();
    setStatus("idle", st.aborted);
    settle();
    renderAll();
  }

  /** Ein während des Laufs zurückgehaltenes Ziel gilt jetzt, wenn keine Runde offen ist. */
  function settle(): void {
    if (offered === null || roundCount() > 0) return;
    session = { ...session, target: offered };
    offered = null;
    kept = false;
  }

  async function apply(): Promise<void> {
    if (roundCount() === 0 || applying || slot.running()) return;
    applying = true;
    renderControls();
    pending = (async () => {
      let outcome: AcceptOutcome;
      try {
        outcome = await deps.accept(session);
      } catch (e) {
        outcome = { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
      try {
        if (outcome.ok) {
          // Das geschriebene Ziel trägt den neuen Text: ohne `retarget` bliebe der Fingerabdruck des Blocks veraltet.
          // Während des Schreibens sind Ziel und Runden gesperrt (`applying`): das Ziel ist noch das, das übernommen wurde.
          // Ein während des Schreibens angebotenes Ziel gilt jetzt (der Nutzer hat es gewählt); das Ergebnis des Übernehmens ist nur dann das neue Ziel, wenn nichts angeboten wurde.
          session = slots.fresh(offered ?? outcome.retarget ?? session.target);
          kept = false;
          offered = null;
          setStatus("ok", outcome.message);
        } else {
          setStatus("error", outcome.message);
        }
      } finally {
        applying = false;
        renderAll();
      }
    })();
    await pending;
  }

  async function confirmDiscard(): Promise<boolean> {
    const n = roundCount();
    return n === 0 || (await deps.confirm(st.discardConfirm(n), { confirm: st.confirmDiscard, cancel: st.confirmKeep }));
  }

  /** Verwerfen: Runden weg; ein angebotenes (zurückgehaltenes) Ziel gilt jetzt. */
  async function discard(): Promise<void> {
    if (slot.running() || applying) return;
    if (!(await confirmDiscard())) return;
    session = slots.fresh(offered ?? session.target);
    kept = false;
    offered = null;
    setStatus("idle", "");
    renderAll();
  }

  async function startNew(): Promise<void> {
    if (slot.running() || applying) return;
    if (!(await confirmDiscard())) return;
    session = slots.fresh({ kind: "new" });
    kept = false;
    offered = null;
    setStatus("idle", "");
    renderAll();
  }

  // ---- Zeichnen ------------------------------------------------------------------------------
  function renderHeader(): void {
    if (destroyed) return;
    const t = session.target;
    const label = t.kind === "new" ? st.targetNew : t.label;
    targetEl.setText(kept ? st.targetKept(label) : t.kind === "new" ? st.targetNew : st.targetEdit(label));
    hintEl.setText(t.kind === "other" ? st.unsupported(t.label) : "");
    const task = taskKind(session);
    const q = slots.quality(model(), task);
    paintStatus(quality, q.measured ? "idle" : "warning", q.text);
    sendBtn.setText(task === "create" ? st.create : st.refine);
    input.setAttribute("placeholder", task === "create" ? st.placeholderCreate : st.placeholderRefine);
    renderControls();
  }

  function renderControls(): void {
    if (destroyed) return;
    const running = slot.running();
    const n = roundCount();
    modelBar.update(); // die Sperre der Modellzeile folgt demselben Zustand
    sendBtn.disabled = !canSend();
    stopBtn.toggleClass("is-hidden", !running);
    const blocked = deps.acceptBlockedReason?.(session) ?? null;
    acceptBtn.disabled = n === 0 || running || applying || blocked !== null;
    acceptHint.setText(blocked ?? "");
    if (blocked === null) acceptBtn.removeAttribute("aria-describedby");
    else acceptBtn.setAttribute("aria-describedby", "svg-studio-accept-hint");
    discardBtn.disabled = n === 0 || running || applying;
    newBtn.disabled = running || applying;
    for (const b of Array.from(noticesHost.querySelectorAll("button"))) b.disabled = running || applying;
    noEndpointEl.toggleClass("is-hidden", !noEndpoint);
    // Zwei getrennte Elemente; trifft beides zu, gewinnt „kein Endpunkt“.
    examplesEl.toggleClass("is-hidden", noEndpoint || running || n > 0 || session.target.kind !== "new");
    previewWrap.toggleClass("is-hidden", n === 0);
  }

  function renderRounds(): void {
    roundsEl.empty();
    const { rounds, active } = session.rounds;
    buildVersionList(roundsEl, {
      items: rounds.map((rd, i) => ({ label: slots.roundLabel(rd, i), meta: slots.roundMeta(rd) })),
      active,
      onSelect: (i) => {
        if (slot.running() || applying) return; // die Anfrage baut auf der Runde, die beim Senden aktiv war
        session = { ...session, rounds: selectRound(session.rounds, i) };
        renderRounds();
        renderChanges();
        renderPreview();
        renderNotices();
      },
      heading: st.rounds,
    });
  }

  function renderPreview(): void {
    const round = activeRound();
    previewCaption.setText(round === null ? st.previewNone : st.previewOf(session.rounds.active + 1));
    previewHost.empty();
    slots.renderPreview(previewHost, round, round === null ? null : slots.roundText(round));
  }

  function renderChanges(): void {
    changesHost.empty();
    slots.renderChanges(changesHost, activeRound(), session);
  }

  let noticeTicket = 0;
  function renderNotices(): void {
    noticesHost.empty();
    if (destroyed || slots.notices === undefined) return;
    const ticket = ++noticeTicket;
    slots.notices(noticesHost, {
      current: () => !destroyed && ticket === noticeTicket,
      busy: () => slot.running() || applying,
      session: () => session,
      setSession(next) {
        if (destroyed || slot.running() || applying) return;
        session = next;
        renderAll();
      },
      run: runAction,
      setStatus,
    });
  }

  function renderAll(): void {
    if (destroyed) return;
    renderHeader();
    renderNotices();
    renderRounds();
    renderChanges();
    renderPreview();
    renderControls();
  }

  renderAll();

  return {
    setStatus,
    renderAll,
    setTarget(target) {
      if (slot.running()) {
        // Während einer Anfrage gilt das Ziel wie bei offenen Runden: es bleibt, das neue wird nur angeboten.
        kept = !sameTarget(session.target, target);
        offered = kept ? target : null;
      } else {
        // Ohne offene Runden gilt das angebotene Ziel sofort; mit offenen bleibt das alte.
        if (roundCount() === 0) session = { ...session, target };
        kept = !sameTarget(session.target, target);
        offered = kept ? target : null;
      }
      renderHeader();
      renderNotices();
    },
    session: () => session,
    running: () => slot.running(),
    settled: () => pending,
    async requestClose() {
      slot.abort();
      // Schreibt Übernehmen noch, ist die Sitzung gleich eine andere (Runden leer, Ziel die neue Datei): erst abwarten, sonst merkte „Behalten“ die alten Runden, und ein
      // erneutes Übernehmen legte eine zweite Datei an.
      if (applying) await pending;
      const n = roundCount();
      if (n === 0) return true;
      return deps.confirm(st.closeConfirm(n), { confirm: st.confirmDiscard, cancel: st.confirmKeep });
    },
    refreshModelBar() {
      modelBar.update();
      renderHeader();
    },
    refreshAccept() {
      renderControls();
    },
    reloadModels() {
      void modelBar.refresh();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      slot.abort();
      modelBar.destroy();
      offChatHost();
      slots.dispose?.();
      panelEl.remove();
    },
  };
}
