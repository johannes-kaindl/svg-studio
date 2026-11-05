/**
 * GUI-Smoke von svg-studio — fährt die Naht zum Host gegen ein LAUFENDES Obsidian (CORE-TEST-02 b, Plan 2 Task C5): Block als Bild, Knopf an der Einbettung,
 * Panel mit Lauf gegen einen Ersatz-Endpunkt (LLM-Stub hinter einem Fake-Manager), Rückfrage, Vorschau im Shadow Root, Übernehmen als Datei und als Block,
 * Lesemodus, Bestand (Inkscape, Namen, Reparatur), Schließen mit offener Runde. Das LLM ist immer der Stub: Antworten aus `tests/fixtures/lab/` (Fälle E8 Erzeugen,
 * V3 Verfeinern). Der Stub belegt Verdrahtung, Strom und Darstellung, nie die Qualität einer Modellantwort.
 *
 * ## Aufruf (Zweitinstanz, nie die reguläre; `--port` ist Pflicht)
 *
 * Alles in einem Zug (baut, stellt den Staging-Vault her, startet eine frische Zweitinstanz, fährt den Lauf, beendet nur die eigene Instanz):
 *
 *   export REPO=svg-studio PORT=9660 UD=/tmp/obs-test-svg-studio BILDER=<ordner> \
 *     && python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label svg-studio --intent "GUI-Smoke" --exclusive focus --port 9660 --ttl 900 \
 *     && ../tools/obsidian-cdp/messlauf.sh
 *
 * Von Hand: `npm run build && npm run smoke:gui -- --setup`, Zweitinstanz mit eigenem Profil starten (README der Brücke § Frisches Profil, `--lang=en-US`), dann
 * `npm run smoke:gui -- --port 9660 --bilder <ordner>`. Der Staging-Vault kommt aus `tests/fixtures/vault/` nach `$STAGING_VAULTS_DIR` (`buildVault`).
 *
 * ## Prüfpunkte
 *
 * Die Soll-Liste `PUNKTE` ist der Nenner der Bilanz (CORE-TEST-19). Was nur von Hand oder am Gerät prüfbar ist, steht als `skipped` mit Grund darin.
 * Bilder (`--bilder <ordner>`): Panel hell und dunkel, Desktop und Mobil-Emulation 390 × 844; sie sind Beleg, keine README-Bilder, und wollen angesehen werden
 * (ein DOM-Smoke ist kein Layout-Beleg).
 *
 * Typen: `npm run typecheck:test` (sieht `scripts/`).
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { cwd } from "node:process";

import { stampedName } from "../src/vendor/kit/rotation";
import { Vorbedingung, createBilanz, parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import {
  AbbruchAusnahme,
  Cdp,
  attachTo,
  beimAbbruch,
  bereiteInstanzVor,
  clearNotices,
  clickReal,
  entferneFakeManager,
  installFakeManager,
  istAbgebrochen,
  ladePluginNeu,
  openExisting,
  openNote,
  pollUntil,
  requireVisible,
  schliesseDialog,
  setPluginSetting,
} from "../../tools/obsidian-cdp/cdp.js";
import { BREITE, HOEHE, mobilAus, mobilEin } from "../../tools/obsidian-cdp/chat-layout.js";
import { startLlmStub, type LlmStub, type StubAnfrage } from "../../tools/obsidian-cdp/llm-stub.js";
import { gegenprobeErreichbarkeit, gegenprobeFokus, messeErreichbarkeit, messeFokusErhalt, mitHoehe, zeichnePflicht, type PflichtTeilurteil } from "../../tools/obsidian-cdp/pflichtpunkte.js";
import { boxOf, capture, setWindowSize } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "svg-studio";
const PLUGIN_ID = "svg-studio";
const VIEW_TYPE = "svg-studio-panel";
const MANAGER_ID = "llm-endpoint-manager";
const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "tests/fixtures/vault");
const LAB_DATEI = join(REPO_ROOT, "tests/fixtures/lab/qwen-qwen3.8-27b-4bit-svg.jsonl");
const ANHANG = "Anhaenge";
/** Notizen, die der Treiber anlegt; sie werden vor und nach dem Lauf weggeräumt. */
const SMOKE_PRAEFIX = "_smoke-";

/** Soll-Liste aller Prüfpunkte — der Nenner der Bilanz (CORE-TEST-19). */
const PUNKTE = [
  "plugin-geladen",
  "block-rendert-als-bild",
  "block-nur-viewbox-sichtbar",
  "einbettung-hat-knopf",
  "knopf-oeffnet-panel",
  "erzeugen-ersatzendpunkt",
  "rueckfrage-nach-ungueltiger-antwort",
  "schattenwurzel-isoliert",
  "fokus-erhalt",
  "fokus-erhalt-gegenprobe",
  "erreichbarkeit",
  "erreichbarkeit-gegenprobe",
  "uebernehmen-als-datei",
  "uebernehmen-als-block",
  "c4a-bediente-notiz",
  "strg-z-nach-block-uebernehmen",
  "block-verschoben-uebernehmen-trifft-block",
  "uebernehmen-lesemodus",
  "c4c-sperre-ohne-notiz",
  "c4d-schnappschuss",
  "c4e-auswahl-dialog",
  "c4f-editor-angaben-entfernen",
  "c4f-namen-vergeben",
  "c4f-reparieren",
  "c4g-nichtzeichen-im-attribut",
  "laufzeit-marke-verhindert-wiederholung",
  "laufzeit-notausschalter",
  "block-bom-und-kosten-im-block",
  "panel-teurer-text-braucht-klick",
  "laufzeit-absturz-neustart",
  "laufzeit-beenden-im-wachfenster",
  "pruefliste-kartenbeschriftung",
  "pruefliste-ablehnen",
  "pruefliste-annehmen",
  "pruefliste-kommentar",
  "bestand-ohne-runde-vorschau",
  "zahlenfeld-genau-ein-attribut",
  "handrunde-in-versionsliste",
  "drehmitte-in-gruppe",
  "schliessen-mit-offener-runde",
  "rest10a-behalten-waehrend-uebernehmen",
  "rest10b-angebotenes-ziel-waehrend-uebernehmen",
  "rest11-folgerunde-nach-namen-vergeben",
  "mobil-emulation",
  "mobil-trefflaeche-44px",
  "mobil-pruefliste-trefflaeche-44px",
  "mobil-felder",
  "mobil-tastaturabstand",
  "mobil-geraet-tastatur",
] as const;
type Name = (typeof PUNKTE)[number];

const bilanz = createBilanz({ punkte: PUNKTE });
const { record, skipped, unmeasured } = bilanz;

const q = (s: unknown): string => JSON.stringify(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const fehlerText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── Stub-Antworten aus der Messung ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface LabFall { case: string; prompt: string; raw: string; input?: string }
function labFall(name: string): LabFall {
  for (const zeile of readFileSync(LAB_DATEI, "utf8").split("\n")) {
    if (zeile.trim() === "") continue;
    const f = JSON.parse(zeile) as LabFall;
    if (f.case === name) return f;
  }
  throw new Error(`Fall ${name} fehlt in ${LAB_DATEI}`);
}
const E8 = labFall("E8");
const V3 = labFall("V3");
/** Erzeugen: der Grundriss aus der Messung. */
const ANTWORT_ERZEUGEN = E8.raw;
/** Verfeinern: V3 baut auf E8 auf (`probe.svg` ist E8). */
const ANTWORT_VERFEINERN = V3.raw;
/** Ungültig für den Bereiniger: ein CSS-Kommentar in `<style>` (Kit-Vertrag von svg-guard). */
const ANTWORT_UNGUELTIG = E8.raw.replace("</desc>", "</desc>\n  <style>/* kommentar */ .x { fill: red }</style>");
/** Ein SVG, dessen `<style>` das ganze Dokument rot färben würde. */
const ANTWORT_STIL = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">`,
  `  <style>* { color: red }</style>`,
  `  <rect id="kasten" x="10" y="10" width="80" height="40" fill="currentColor"/>`,
  `  <circle id="punkt" cx="50" cy="30" r="8" fill="white"/>`,
  `</svg>`,
].join("\n");
/** Die Reparatur von `kaputt.svg`. */
const ANTWORT_REPARATUR = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">`,
  `  <rect id="kasten" x="10" y="10" width="80" height="40" fill="#e8e0d0"/>`,
  `  <circle id="punkt" cx="30" cy="30" r="8" fill="#8b7355"/>`,
  `</svg>`,
].join("\n");
/** Ersetzt genau eine Stelle; fehlt sie, ist die Fixture-Antwort veraltet (der Treiber bricht, statt still etwas anderes zu messen). */
function ersetze(text: string, von: string, nach: string): string {
  if (!text.includes(von)) throw new Error(`Stub-Antwort: „${von}“ steht nicht in der Vorlage`);
  return text.replace(von, nach);
}
/** Drei Änderungen in drei Elementen auf `probe.svg` (= E8): Tür nach links (x), Nordwand dicker (stroke-width), Südwand dunkelrot (stroke). Die Prüfliste zeigt drei Karten. */
const TUER: readonly [string, string] = [`x="165"`, `x="145"`];
const NORD: readonly [string, string] = [`<line id="wand-nord" x1="0" y1="0" x2="420" y2="0" stroke="black" stroke-width="2"`, `<line id="wand-nord" x1="0" y1="0" x2="420" y2="0" stroke="black" stroke-width="6"`];
const SUED: readonly [string, string] = [`<line id="wand-sued" x1="420" y1="385" x2="0" y2="385" stroke="black"`, `<line id="wand-sued" x1="420" y1="385" x2="0" y2="385" stroke="#8b0000"`];
const OST: readonly [string, string] = [`<line id="wand-ost" x1="420" y1="0" x2="420" y2="385" stroke="black" stroke-width="2"`, `<line id="wand-ost" x1="420" y1="0" x2="420" y2="385" stroke="black" stroke-width="4"`];
const mit = (text: string, ...aenderungen: (readonly [string, string])[]): string => aenderungen.reduce((t, [von, nach]) => ersetze(t, von, nach), text);
const ANTWORT_MEHRERE = mit(E8.raw, TUER, NORD, SUED);
const ANTWORT_OSTWAND = mit(ANTWORT_MEHRERE, OST);
/** Verfeinern auf `felder.svg`: der Mond bekommt eine wärmere Füllung (eine Änderung). */
const FELDER_FILL: readonly [string, string] = [`fill="#f5f5dc"`, `fill="#ffeecc"`];
const PROMPT_ERZEUGEN = "Grundriss 420 x 385 cm mit Tür";
const PROMPT_VERFEINERN = "Verschiebe die Tür um 20 cm nach links.";
const PROMPT_MEHRERE = "Tür 20 cm nach links, Nordwand dicker, Südwand dunkelrot.";
const KOMMENTAR = "Die Tür bitte nur 10 cm nach links.";

const fixtur = (name: string): string => readFileSync(join(FIXTURE_DIR, "notes", name), "utf8");

// ── Zustand des Treibers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

let cdp: Cdp;
let stub: LlmStub;
let bilderDir: string | null = null;
let port = 0;
/** Konsole und Ausnahmen des Fensters (Mitschnitt der Brücke): bei einem Fehlschlag steht das Ende davon in der Meldung. */
const konsole: string[] = [];
/** `--nur a,b`: nur diese Punkte fahren, die übrigen stehen als übersprungen in der Bilanz (Entwicklung des Treibers; der volle Lauf ist die Baseline). */
let nur: Set<string> | null = null;
const gewaehlt = (...namen: Name[]): boolean => nur === null || namen.some((n) => nur!.has(n));

const chatAnfragen = (): StubAnfrage[] => stub.anfragen().filter((a) => a.route === "chat");
const nachrichten = (a: StubAnfrage): { role: string; content: string }[] => (a.json as { messages?: { role: string; content: string }[] } | null)?.messages ?? [];

/** Ein Punkt: Ausnahmen werden „nichts gemessen“ (ein Abbruch läuft durch), ein stiller Punkt ebenfalls. */
async function lauf(name: Name, fn: () => Promise<void>): Promise<void> {
  if (!gewaehlt(name)) return;
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (e) {
    if (e instanceof AbbruchAusnahme || istAbgebrochen()) throw e;
    unmeasured(name, e instanceof Vorbedingung ? e.message : `Ausnahme im Treiber: ${fehlerText(e)}`);
  }
  if (!bilanz.eintraege().some((p) => p.name === name)) unmeasured(name, "der Punkt hat nichts aufgezeichnet");
}

function urteil(name: Name, u: PflichtTeilurteil): void {
  zeichnePflicht(bilanz, name, u);
}

// ── Panel lesen und bedienen ───────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Snap {
  target: string | null;
  status: string | null;
  statusClass: string;
  rounds: number;
  labels: string[];
  metas: string[];
  listRows: number;
  acceptDisabled: boolean | null;
  sendDisabled: boolean | null;
  running: boolean;
  hint: string | null;
  measure: string | null;
  caption: string | null;
  previewHidden: boolean;
  svgIds: string[] | null;
  cards: { id: string; text: string; cls: string; comment: string; del: string; ins: string }[];
  fields: { name: string; value: string; readOnly: boolean; disabled: boolean; inputmode: string | null }[];
  fieldsHead: string | null;
  fieldsHint: string | null;
  notices: { text: string; button: string }[];
  changes: string[];
  error: string | null;
}

const SNAP_JS = `
  const root = document.querySelector(".svg-studio-panel");
  if (!root) return null;
  const txt = (s) => { const e = root.querySelector(s); return e ? (e.textContent || "").trim() : null; };
  const stage = root.querySelector(".svg-studio-stage");
  const svg = stage && stage.shadowRoot ? stage.shadowRoot.querySelector("svg") : null;
  const accept = root.querySelector(".svg-studio-accept");
  const send = root.querySelector(".svg-studio-send");
  const stop = root.querySelector(".svg-studio-stop");
  const prev = root.querySelector(".svg-studio-preview");
  const status = root.querySelector(".svg-studio-status");
  // Die Rundenliste des Kits entsteht erst ab zwei Runden; die Zahl der Runden nennt die Sitzung der Ansicht (Testnaht state()).
  const leaf = app.workspace.getLeavesOfType("svg-studio-panel")[0];
  const sit = leaf && leaf.view && leaf.view.state ? leaf.view.state() : null;
  const rs = sit ? sit.rounds.rounds : [];
  return {
    target: txt(".svg-studio-target"),
    status: txt(".svg-studio-status"),
    statusClass: status ? status.className : "",
    rounds: rs.length,
    labels: rs.map((r) => r.instruction),
    metas: rs.map((r) => r.art + (r.body ? ":" + r.body.form : "")),
    listRows: root.querySelectorAll(".okit-vlist-row").length,
    acceptDisabled: accept ? accept.disabled : null,
    sendDisabled: send ? send.disabled : null,
    running: stop ? !stop.classList.contains("is-hidden") : false,
    hint: txt(".svg-studio-accept-hint"),
    measure: txt(".svg-studio-measure"),
    caption: txt(".svg-studio-preview-caption"),
    previewHidden: prev ? prev.classList.contains("is-hidden") : true,
    svgIds: svg ? Array.from(svg.querySelectorAll("[id]")).map((e) => e.getAttribute("id")) : null,
    cards: Array.from(root.querySelectorAll(".svg-studio-changes .okit-review-card")).map((c) => ({
      id: c.getAttribute("data-id") || "",
      text: ((c.querySelector(".okit-review-main") || {}).innerText || "").replace(/\\s+/g, " ").trim(),
      cls: c.className,
      comment: ((c.querySelector(".svg-studio-card-comment") || {}).textContent || "").trim(),
      del: Array.from(c.querySelectorAll(".okit-redline-del")).map((e) => (e.textContent || "").trim()).join("|"),
      ins: Array.from(c.querySelectorAll(".okit-redline-ins")).map((e) => (e.textContent || "").trim()).join("|"),
    })),
    fields: Array.from(root.querySelectorAll(".svg-studio-fields .svg-studio-field-input")).map((i) => ({ name: i.getAttribute("data-field") || "", value: i.value, readOnly: i.readOnly, disabled: i.disabled, inputmode: i.getAttribute("inputmode") })),
    fieldsHead: txt(".svg-studio-fields-head"),
    fieldsHint: txt(".svg-studio-fields-hint"),
    notices: Array.from(root.querySelectorAll(".svg-studio-notice")).map((n) => ({
      text: ((n.querySelector(".svg-studio-notice-text") || {}).textContent || "").trim(),
      button: ((n.querySelector("button") || {}).textContent || "").trim(),
    })),
    changes: Array.from(root.querySelectorAll(".svg-studio-changes .okit-redline")).map((e) => e.textContent),
    error: txt(".svg-studio-error"),
  };
`;

const snap = (): Promise<Snap | null> => cdp.evaluate<Snap | null>(SNAP_JS);

async function warteSnap(ok: (s: Snap) => boolean, ms = 15000): Promise<Snap | null> {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    const s = await snap();
    if (s !== null && ok(s)) return s;
    await sleep(150);
  }
  return null;
}

async function oeffneNeuesPanel(): Promise<Snap> {
  await cdp.evaluate(`app.commands.executeCommandById("${PLUGIN_ID}:new-svg"); return true;`);
  const s = await warteSnap((x) => x.target !== null, 10000);
  if (s === null) throw new Vorbedingung("Das Panel kam nach „New SVG“ nicht hoch");
  return s;
}

async function tippe(text: string): Promise<void> {
  await cdp.evaluate(`const el = document.querySelector(".svg-studio-input"); el.focus(); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
  await cdp.send("Input.insertText", { text });
  const wert = await cdp.evaluate<string>(`return document.querySelector(".svg-studio-input").value;`);
  if (wert !== text) {
    await cdp.evaluate(`const el = document.querySelector(".svg-studio-input"); el.value = ${q(text)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
  }
}

/** Klick mit vorherigem Rollen OHNE Animation: `scrollIntoView` der Brücke rollt weich, die Lage wird mitten in der Bewegung gemessen und der Klick trifft den Behälter statt des Knopfs
 *  (gemessen in diesem Treiber: Ereignisse auf `svg-studio-actions` statt `svg-studio-send`). */
async function klick(ausdruck: string): Promise<boolean> {
  await cdp.evaluate(`const el = ${ausdruck}; if (el) el.scrollIntoView({ block: "center", behavior: "instant" }); return true;`);
  await sleep(250);
  return clickReal(cdp, ausdruck);
}

const klickSenden = async (): Promise<void> => {
  if (!(await klick(`document.querySelector(".svg-studio-send")`))) throw new Vorbedingung("Senden-Knopf nicht klickbar");
};

/** Prompt tippen, senden und auf die neue Runde (oder einen Fehler) warten. */
async function frage(text: string, ms = 30000): Promise<Snap> {
  const vorher = (await snap())?.rounds ?? 0;
  await tippe(text);
  await klickSenden();
  const s = await warteSnap((x) => x.rounds > vorher || (x.statusClass.includes("is-error") && !x.running), ms);
  if (s === null) {
    const d = await snap();
    const z = stub.zaehler();
    const e = await cdp.evaluate<string>(`const i = document.querySelector(".svg-studio-input"); return JSON.stringify({ wert: i ? i.value : null, fokus: document.activeElement ? document.activeElement.className : null });`);
    throw new Vorbedingung(`Keine neue Runde nach „${text}“ (Status: ${q(d?.status)}, Klasse ${q(d?.statusClass)}, Senden gesperrt ${d?.sendDisabled}, läuft ${d?.running}; Stub: ${q(z)} ${q(stub.alleAnfragen().map((a) => `${a.methode} ${a.pfad}`))}; Eingabe ${e}; Konsole ${q(konsole.slice(-6))})`);
  }
  if (s.rounds <= vorher) throw new Vorbedingung(`Der Lauf endete mit Fehler: ${s.status ?? "?"}`);
  return s;
}

/** Übernehmen klicken; wartet, bis die Runden weg sind (Erfolg) oder der Status Fehler meldet. */
async function uebernimm(ms = 20000): Promise<{ ok: boolean; snap: Snap }> {
  if (!(await klick(`document.querySelector(".svg-studio-accept")`))) throw new Vorbedingung("Übernehmen-Knopf nicht klickbar");
  const s = await warteSnap((x) => x.rounds === 0 || (x.statusClass.includes("is-error") && !x.running && x.acceptDisabled === false), ms);
  if (s === null) throw new Vorbedingung(`Übernehmen endete nicht (Status: ${(await snap())?.status ?? "kein Panel"})`);
  return { ok: s.rounds === 0, snap: s };
}

const klickText = (bereich: string, re: RegExp): Promise<boolean> =>
  klick(`(Array.from(document.querySelectorAll(${q(`${bereich} button`)})).find((b) => new RegExp(${q(re.source)}, ${q(re.flags)}).test(b.textContent || "")))`);

interface Dlg { title: string; paras: string[]; buttons: string[] }
const DLG_JS = `
  const m = document.querySelector(".modal-container .modal");
  if (!m) return null;
  return {
    title: ((m.querySelector(".modal-title") || {}).textContent || "").trim(),
    paras: Array.from(m.querySelectorAll("p")).map((p) => (p.textContent || "").trim()),
    buttons: Array.from(m.querySelectorAll(".modal-button-container button")).map((b) => (b.textContent || "").trim()),
  };
`;
const warteDialog = (ms = 4000): Promise<Dlg | null> => pollUntil<Dlg>(cdp, DLG_JS, ms, 150);
const dialogKlick = (re: RegExp): Promise<boolean> =>
  klick(`(Array.from(document.querySelectorAll(".modal-container .modal-button-container button")).find((b) => new RegExp(${q(re.source)}, ${q(re.flags)}).test(b.textContent || "")))`);

// ── Vorschau, Felder und Prüfliste bedienen ────────────────────────────────────────────────────────────────────────────────────────────

const IM_BILD = (id: string): string =>
  `(() => { const st = document.querySelector(".svg-studio-stage"); const svg = st && st.shadowRoot ? st.shadowRoot.querySelector("svg") : null; return svg ? Array.from(svg.querySelectorAll("[id]")).find((e) => e.getAttribute("id") === ${q(id)}) : null; })()`;

/** Echter Mausklick auf ein Element im Shadow Root der Vorschau; wartet, bis die Zahlenfelder dieses Elements da sind. */
async function klickImBild(id: string): Promise<Snap> {
  if (!(await klick(IM_BILD(id)))) throw new Vorbedingung(`Element ${id} in der Vorschau nicht klickbar`);
  const s = await warteSnap((x) => (x.fieldsHead ?? "").includes(id), 5000);
  if (s === null) throw new Vorbedingung(`Nach dem Klick auf ${id} zeigt das Panel keine Felder (Kopf ${q((await snap())?.fieldsHead)}, Hinweis ${q((await snap())?.fieldsHint)})`);
  return s;
}

/** Ein Zahlenfeld: Fokus, Inhalt ersetzen, Enter (echte Tasten). */
async function setzeFeld(name: string, wert: string): Promise<void> {
  const da = await cdp.evaluate<boolean>(`const i = document.querySelector('.svg-studio-field-input[data-field="${name}"]'); if (!i || i.readOnly || i.disabled) return false; i.focus(); i.select(); return true;`);
  if (!da) throw new Vorbedingung(`Feld ${name} fehlt oder ist gesperrt`);
  await cdp.send("Input.insertText", { text: wert });
  const taste = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...taste });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...taste });
}

const vorschauAttr = (id: string, name: string): Promise<string | null> => cdp.evaluate<string | null>(`const e = ${IM_BILD(id)}; return e ? e.getAttribute(${q(name)}) : null;`);

/** Das Panel auf `probe.svg` über den Knopf an der Einbettung (wie ein Nutzer). */
async function oeffneProbeImPanel(): Promise<void> {
  if (!(await openExisting(cdp, "Einbettung.md", "preview"))) throw new Vorbedingung("Einbettung.md rendert nicht");
  const knopf = `Array.from(document.querySelectorAll(".markdown-preview-view .internal-embed.image-embed [data-svg-studio-button]")).find((b) => b.getBoundingClientRect().width > 0)`;
  await pollUntil(cdp, `return (${knopf}) ? true : null;`, 8000, 250);
  if (!(await klick(`(${knopf})`))) throw new Vorbedingung("Einbettungsknopf nicht klickbar");
  if ((await warteSnap((s) => (s.target ?? "").includes("probe.svg"), 8000)) === null) throw new Vorbedingung("Panel nicht auf probe.svg");
}

const kartenKnopf = (re: RegExp, knopf: string): string =>
  `(() => { const c = Array.from(document.querySelectorAll(".svg-studio-changes .okit-review-card")).find((x) => new RegExp(${q(re.source)}, ${q(re.flags)}).test((x.querySelector(".okit-review-main") || {}).innerText || "")); return c ? c.querySelector(${q(knopf)}) : null; })()`;

// ── Notizen und Dateien ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function schreibe(path: string, body: string): Promise<void> {
  await cdp.evaluate(`
    const f = app.vault.getAbstractFileByPath(${q(path)});
    if (f) await app.vault.modify(f, ${q(body)}); else await app.vault.create(${q(path)}, ${q(body)});
    return true;
  `);
}

async function stelleFixturenHer(): Promise<void> {
  for (const n of ["probe.svg", "inkscape.svg", "unbenannt.svg", "kaputt.svg", "felder.svg", "drehung.svg", "Block.md", "Einbettung.md"]) await schreibe(n, fixtur(n));
}

async function liesDatei(path: string): Promise<string | null> {
  return cdp.evaluate<string | null>(`const f = app.vault.getAbstractFileByPath(${q(path)}); return f ? await app.vault.read(f) : null;`);
}

/** Text einer Notiz so, wie Obsidian ihn hält: offener Quell-Editor, sonst Vault. */
async function notizText(path: string): Promise<string | null> {
  return cdp.evaluate<string | null>(`
    const l = app.workspace.getLeavesOfType("markdown").find((x) => x.view.file && x.view.file.path === ${q(path)} && x.view.getMode() === "source");
    if (l) return l.view.editor.getValue();
    const f = app.vault.getAbstractFileByPath(${q(path)});
    return f ? await app.vault.read(f) : null;
  `);
}

const anhaenge = (): Promise<string[]> => cdp.evaluate<string[]>(`return app.vault.getFiles().filter((f) => f.path.startsWith(${q(`${ANHANG}/`)})).map((f) => f.path);`);

/** Neue Notiz in einem neuen Tab (oder geteiltem Blatt) öffnen und aktiv machen. */
async function oeffneNotiz(path: string, body: string, mode: "source" | "preview", wie: "tab" | "split" | "aktuell" = "aktuell"): Promise<void> {
  if (wie === "aktuell") {
    await openNote(cdp, path, body, mode);
  } else {
    await schreibe(path, body);
    await cdp.evaluate(`
      const f = app.vault.getAbstractFileByPath(${q(path)});
      const leaf = ${wie === "split" ? `app.workspace.getLeaf("split", "vertical")` : `app.workspace.getLeaf("tab")`};
      await leaf.openFile(f, { state: { mode: ${q(mode)} } });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      return true;
    `);
  }
  await sleep(600);
}

async function setzeCursor(path: string, line: number): Promise<void> {
  await cdp.evaluate(`
    const l = app.workspace.getLeavesOfType("markdown").find((x) => x.view.file && x.view.file.path === ${q(path)});
    if (l && l.view.editor) { app.workspace.setActiveLeaf(l, { focus: true }); l.view.editor.setCursor({ line: ${line}, ch: 0 }); }
    return true;
  `);
}

const setzeAcceptAs = (v: "file" | "block" | "ask"): Promise<void> => setPluginSetting(cdp, PLUGIN_ID, "acceptAs", v);

async function schliesseNotizen(): Promise<void> {
  await cdp.evaluate(`const alle = []; app.workspace.iterateRootLeaves((l) => alle.push(l)); for (const l of alle) l.detach(); return true;`);
  await sleep(500);
}

/** Zurück auf einen sauberen Ausgang: Dialoge zu, Panel zu (offene Runden verworfen), Notizen zu, Übernehmen-Ziel Datei, Stub leer. */
async function raeume(): Promise<void> {
  await clearNotices(cdp);
  await schliesseDialog(cdp, { fristMs: 500 }).catch(() => undefined);
  await cdp.evaluate(`delete app.vault.create; for (const l of app.workspace.getLeavesOfType(${q(VIEW_TYPE)})) l.detach(); return true;`);
  const d = await warteDialog(1200);
  if (d !== null) {
    await dialogKlick(/discard|verwerfen/i);
    await sleep(300);
  }
  await schliesseNotizen();
  await setzeAcceptAs("file");
  await cdp.evaluate(`
    for (const f of app.vault.getFiles().filter((x) => x.path.startsWith(${q(`${ANHANG}/`)}) || x.name.startsWith(${q(SMOKE_PRAEFIX)}))) await app.fileManager.trashFile(f);
    return true;
  `);
  stub.antworten([]);
  stub.loescheMitschnitt();
}

async function schnappschussWurzel(): Promise<string> {
  return cdp.evaluate<string>(`return app.vault.configDir + "/plugins/${PLUGIN_ID}/snapshots";`);
}
async function loescheSchnappschuesse(): Promise<void> {
  const w = await schnappschussWurzel();
  await cdp.evaluate(`if (await app.vault.adapter.exists(${q(w)})) await app.vault.adapter.rmdir(${q(w)}, true); return true;`);
}

// ── Bilder ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function setzeThema(modus: "hell" | "dunkel"): Promise<void> {
  await cdp.evaluate(`document.body.classList.remove("theme-light", "theme-dark"); document.body.classList.add(${q(modus === "dunkel" ? "theme-dark" : "theme-light")}); app.workspace.trigger("css-change"); return true;`);
  await sleep(500);
}

async function bildSchreiben(name: string, png: Buffer): Promise<void> {
  if (bilderDir === null) return;
  mkdirSync(bilderDir, { recursive: true });
  writeFileSync(join(bilderDir, name), png);
  console.log(`    Bild: ${name} (${Math.round(png.length / 1024)} KB)`);
}

/** Das Panel in seinem jetzigen Zustand: ganzes Fenster und Panel allein, oben und unten, hell und dunkel. */
async function nimmBilder(tag: string): Promise<void> {
  if (bilderDir === null) return;
  const panel = `.workspace-leaf-content[data-type="${VIEW_TYPE}"]`;
  for (const modus of ["hell", "dunkel"] as const) {
    await setzeThema(modus);
    await bildSchreiben(`panel-${modus}-${tag}-fenster.png`, await capture(cdp, undefined, 1));
    const box = await boxOf(cdp, panel);
    if (box !== null) await bildSchreiben(`panel-${modus}-${tag}-oben.png`, await capture(cdp, box, 1));
    await cdp.evaluate(`const p = document.querySelector(".svg-studio-panel"); if (p) p.scrollTop = p.scrollHeight; return true;`);
    await sleep(300);
    const box2 = await boxOf(cdp, panel);
    if (box2 !== null) await bildSchreiben(`panel-${modus}-${tag}-unten.png`, await capture(cdp, box2, 1));
    await cdp.evaluate(`const p = document.querySelector(".svg-studio-panel"); if (p) p.scrollTop = 0; return true;`);
  }
  await setzeThema("hell");
}

// ── Aufbau ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function setup(): void {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE_DIR, pluginId: PLUGIN_ID });
  console.log(`Staging-Vault gebaut: ${vaultDir}`);
  for (const l of log) console.log(`  · ${l}`);
}

interface Vorbereitet { hinweis: string; version: string | null; versionPasst: boolean | undefined; neu: string }

async function bereiteVor(c: Cdp): Promise<Vorbereitet> {
  await requireVisible(c);
  const klar = await bereiteInstanzVor(c, { pluginIds: [PLUGIN_ID], nurVault: REPO_NAME, sprache: "en", erwarteteVersion: "1.15" });
  const neu = await ladePluginNeu(c, PLUGIN_ID, { repoMainJs: join(REPO_ROOT, "main.js"), sprache: "en", melde: (m) => console.log(`  ! ${m}`) });
  if (!neu.geladen) throw new Error(`Plugin nicht aktiv — ${neu.hinweis}`);
  if (!neu.aktuell) throw new Error(neu.hinweis);
  const fm = await installFakeManager(c, {
    pluginId: MANAGER_ID,
    invalidiere: [PLUGIN_ID],
    endpunkte: [{ id: "smoke-stub", label: "Stub", url: stub.url, models: ["stub-modell"], defaultModel: "stub-modell", capabilities: ["chat"] }],
  });
  if (!fm.installiert) throw new Error(`Fake-Manager nicht eingebaut: ${fm.grund ?? "?"}`);
  return { hinweis: klar.hinweis, version: klar.version, versionPasst: klar.versionPasst, neu: neu.hinweis };
}

// ── Die Punkte ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const SICHTBAR = `const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };`;

async function punktBlock(): Promise<void> {
  await lauf("block-rendert-als-bild", async () => {
    await raeume();
    await stelleFixturenHer();
    const messe = (scope: string): Promise<{ n: number; nw: number; nh: number; complete: boolean; src: string; w: number; edit: boolean } | null> =>
      pollUntil(cdp, `
        ${SICHTBAR}
        const imgs = Array.from(document.querySelectorAll(${q(`${scope} img.svg-studio-img`)})).filter(vis);
        if (imgs.length === 0) return null;
        const i = imgs[0];
        return { n: imgs.length, nw: i.naturalWidth, nh: i.naturalHeight, complete: i.complete, src: i.src.slice(0, 26), w: Math.round(i.getBoundingClientRect().width), edit: !!i.closest(".svg-studio-block").querySelector(".svg-studio-edit") };
      `, 8000, 250);
    if (!(await openExisting(cdp, "Block.md", "preview"))) throw new Vorbedingung("Block.md (Lesemodus) rendert nicht");
    const lesen = await messe(".markdown-preview-view");
    if (!(await openExisting(cdp, "Block.md", "source"))) throw new Vorbedingung("Block.md (Live Preview) rendert nicht");
    const lp = await messe(".markdown-source-view");
    const modus = await cdp.evaluate<string>(`const l = app.workspace.getMostRecentLeaf(app.workspace.rootSplit); return JSON.stringify({ mode: l.view.getMode(), source: l.view.getState().source });`);
    const gut = (m: typeof lesen): boolean => m !== null && m.n === 1 && m.nw > 0 && m.nh > 0 && m.complete && m.src.startsWith("data:image/svg+xml") && m.edit;
    record("block-rendert-als-bild", gut(lesen) && gut(lp), `Lesemodus ${q(lesen)} · Live Preview ${q(lp)} (Blattzustand ${modus})`);
  });
  // Ein SVG nur mit viewBox (so schreiben Modelle) hat keine eigene Größe: als Bild im inline-block mit max-width 100% war es 0 px breit (Bild-Lauf 2026-11-05); die Fixture von oben trägt width und height und sieht den Fall nicht.
  await lauf("block-nur-viewbox-sichtbar", async () => {
    await raeume();
    const quelle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 160"><rect id="r" x="10" y="10" width="260" height="140" fill="#e8e0d0" stroke="#8b7355"/></svg>`;
    const body = `# Nur viewBox\n\n\`\`\`svg-studio\n${quelle}\n\`\`\`\n\nText danach.\n`;
    const messe = (scope: string): Promise<{ n: number; w: number; h: number } | null> =>
      pollUntil(cdp, `
        ${SICHTBAR}
        const imgs = Array.from(document.querySelectorAll(${q(`${scope} img.svg-studio-img`)}));
        if (imgs.length === 0) return null;
        const r = imgs[0].getBoundingClientRect();
        return { n: imgs.length, w: Math.round(r.width), h: Math.round(r.height) };
      `, 8000, 250);
    await oeffneNotiz(`${SMOKE_PRAEFIX}viewbox.md`, body, "preview");
    const lesen = await messe(".markdown-preview-view");
    await oeffneNotiz(`${SMOKE_PRAEFIX}viewbox.md`, body, "source");
    const lp = await messe(".markdown-source-view");
    const ok = (m: typeof lesen): boolean => m !== null && m.n === 1 && m.w >= 200 && m.h >= 100;
    record("block-nur-viewbox-sichtbar", ok(lesen) && ok(lp), `Lesemodus ${q(lesen)} · Live Preview ${q(lp)} (viewBox 280 × 160, erwartet etwa 280 × 160 px, nicht 0)`);
  });
}

/** Der Quelltext des ersten ```svg-studio-Blocks einer Notiz, wie ihn der Codeblock-Prozessor bekommt (Zeilen zwischen den Zäunen, ohne den letzten Umbruch). */
function blockQuelle(note: string): string {
  const m = /```svg-studio\n([\s\S]*?)\n```/.exec(note);
  if (m === null) throw new Vorbedingung("Block.md enthält keinen svg-studio-Block");
  return m[1];
}

/** Zustand des Blocks in der geöffneten Notiz: Bild(er), Platzhalter, Knopf, Marken im App-Speicher. */
const blockZustand = (): Promise<{ imgs: number; naturalWidth: number; held: string | null; knopf: string | null; marken: number } | null> =>
  pollUntil(cdp, `
    const block = document.querySelector(".markdown-preview-view .svg-studio-block");
    if (!block) return null;
    const img = block.querySelector("img.svg-studio-img");
    const held = block.querySelector(".svg-studio-held");
    const knopf = block.querySelector("button.svg-studio-show");
    const marken = app.plugins.plugins[${q(PLUGIN_ID)}].markStore.read();
    return { imgs: block.querySelectorAll("img.svg-studio-img").length, naturalWidth: img ? img.naturalWidth : 0, held: held ? held.innerText : null, knopf: knopf ? knopf.innerText : null, marken: Array.isArray(marken) ? marken.length : 0 };
  `, 8000, 250);

/** Wartet, bis die Zahl der Marken im App-Speicher `n` ist (der Wächter löscht sie nach rund 2 s Ruhe), und liefert dann den Zustand des Blocks; `null` bei Zeitüberschreitung. */
async function warteMarken(n: number, ms: number): Promise<Awaited<ReturnType<typeof blockZustand>>> {
  const bis = Date.now() + ms;
  let z = await blockZustand();
  while (z !== null && z.marken !== n && Date.now() < bis) { await sleep(300); z = await blockZustand(); }
  return z;
}

/** Eine andere Notiz und dann Block.md öffnen, damit der Block sicher neu gerendert wird (Zustand der Marke am Start). */
async function oeffneBlockNeu(): Promise<void> {
  if (!(await openExisting(cdp, "Einbettung.md", "preview"))) throw new Vorbedingung("Einbettung.md rendert nicht");
  if (!(await openExisting(cdp, "Block.md", "preview"))) throw new Vorbedingung("Block.md (Lesemodus) rendert nicht");
}

async function punktLaufzeitSchutz(): Promise<void> {
  const setzeAutoShow = (v: boolean): Promise<void> => setPluginSetting(cdp, PLUGIN_ID, "autoShow", v);
  const loescheMarken = (): Promise<unknown> => cdp.evaluate(`app.plugins.plugins[${q(PLUGIN_ID)}].markStore.write([]); return true;`);
  await lauf("laufzeit-marke-verhindert-wiederholung", async () => {
    await raeume();
    await stelleFixturenHer();
    await setzeAutoShow(true);
    const quelle = blockQuelle(fixtur("Block.md"));
    await loescheMarken();
    // Gegenprobe ohne Marke: das Bild erscheint, und die Marke fällt nach dem Ruhefenster des Wächters (rund 2 s) wieder.
    await oeffneBlockNeu();
    const ohne = await blockZustand();
    const ohneNach = await warteMarken(0, 8000);
    // Der Absturz-Zustand: eine Marke einer früheren Sitzung für genau diesen Block steht (wie nach einem eingefrorenen und beendeten Obsidian).
    const fp = createHash("sha256").update(quelle, "utf8").digest("hex");
    await cdp.evaluate(`app.plugins.plugins[${q(PLUGIN_ID)}].markStore.write([{ fp: ${q(fp)}, at: Date.now(), session: "frueher" }]); return true;`);
    const gesetzt = await cdp.evaluate<boolean>(`return app.plugins.plugins[${q(PLUGIN_ID)}].markStore.read().length === 1;`);
    await oeffneBlockNeu();
    const mit = await blockZustand();
    const geklickt = await klick(`document.querySelector(".markdown-preview-view .svg-studio-block button.svg-studio-show")`);
    const danach = await warteMarken(0, 8000);
    const gut = ohne !== null && ohne.imgs === 1 && ohne.naturalWidth > 0 && ohne.held === null
      && ohneNach !== null && ohneNach.marken === 0 && ohneNach.imgs === 1
      && gesetzt
      && mit !== null && mit.imgs === 0 && mit.held !== null && mit.knopf !== null && mit.marken >= 1
      && geklickt
      && danach !== null && danach.imgs === 1 && danach.naturalWidth > 0 && danach.held === null && danach.marken === 0;
    record("laufzeit-marke-verhindert-wiederholung", gut, `ohne Marke ${q(ohne)} → nach dem Ruhefenster ${q(ohneNach)} · Marke gesetzt ${String(gesetzt)} · Neustart des Blocks ${q(mit)} · nach „Trotzdem anzeigen“ (Klick ${String(geklickt)}) ${q(danach)}`);
  });

  await lauf("laufzeit-notausschalter", async () => {
    await raeume();
    await stelleFixturenHer();
    try {
      await loescheMarken();
      await setzeAutoShow(false);
      await oeffneBlockNeu();
      const aus = await blockZustand();
      const geklickt = await klick(`document.querySelector(".markdown-preview-view .svg-studio-block button.svg-studio-show")`);
      const nach = await warteMarken(0, 8000);
      const gut = aus !== null && aus.imgs === 0 && aus.held !== null && aus.knopf !== null && aus.marken === 0 && geklickt && nach !== null && nach.imgs === 1 && nach.naturalWidth > 0 && nach.held === null;
      record("laufzeit-notausschalter", gut, `aus ${q(aus)} · nach „Anzeigen“ (Klick ${String(geklickt)}) ${q(nach)}`);
    } finally {
      await setzeAutoShow(true);
    }
  });
}

/** Eine Polylinie mit `marker-mid` und einem Marker aus Kreisen: der Kostenwert wächst mit Punkten × Kreisen (code-kit 0.58.0). 700 × 500 liegt etwa bei 35 % der Grenze (ab 25 % wartet der Block auf einen Klick), 2000 × 1000 weit darüber (`too-costly`). */
function kostenSvg(punkte: number, kreise: number): string {
  const pts = Array.from({ length: punkte }, (_, i) => `${String(i % 100)},${String((i * 7) % 100)}`).join(" ");
  const dots = Array.from({ length: kreise }, (_, i) => `<circle cx="${String(i % 10)}" cy="${String(Math.floor(i / 10) % 10)}" r="0.2"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Kosten ${String(punkte)}x${String(kreise)}</title><defs><marker id="m" markerWidth="10" markerHeight="10">${dots}</marker></defs><polyline points="${pts}" fill="none" stroke="black" marker-mid="url(#m)"/></svg>`;
}

/**
 * Code-kit 0.58.0 im echten Obsidian: ein führendes BOM im Block kommt beim Plugin an und wird gezeichnet,
 * ein zu teures SVG zeigt den Meldetext `too-costly` statt „code: detail“, eines nahe der Kostengrenze wartet auf einen Klick und wird dann gezeichnet, ein kleines sofort.
 */
async function punktBomUndKosten(): Promise<void> {
  await lauf("block-bom-und-kosten-im-block", async () => {
    await raeume();
    await stelleFixturenHer();
    await setPluginSetting(cdp, PLUGIN_ID, "autoShow", true);
    await cdp.evaluate(`${PLUGIN_MARKEN}.write([]); return true;`);
    const klein = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>klein</title><circle id="c" cx="5" cy="5" r="4"/></svg>`;
    const bloecke = [`\uFEFF${klein}`, `\uFEFF\uFEFF${klein}`, kostenSvg(2000, 1000), kostenSvg(700, 500), klein];
    await schreibe("Guard.md", `# Guard\n\n${bloecke.map((b) => `\`\`\`svg-studio\n${b}\n\`\`\``).join("\n\n")}\n`);
    await requireVisible(cdp);
    // Was der Block-Prozessor wirklich bekommt: die ersten Zeichen jeder Quelle, die `begin` der Marke sieht (reicht Obsidian das BOM durch, und wie oft?).
    await cdp.evaluate(`const g = app.plugins.plugins[${q(PLUGIN_ID)}].renderGuard; if (!g.__orig) { g.__orig = g.begin; } window.__quellen = []; g.begin = (text, win) => { window.__quellen.push(Array.from(text.slice(0, 3)).map((c) => c.charCodeAt(0).toString(16)).join(",") + "|" + text.length); return g.__orig(text, win); }; return true;`);
    await cdp.evaluate(`const f = app.vault.getAbstractFileByPath("Guard.md"); setTimeout(() => { app.workspace.getLeaf("tab").openFile(f, { state: { mode: "preview" } }); }, 50); return true;`);
    const zustand = (n: number): Promise<Array<{ imgs: number; nw: number; held: string | null; knopf: string | null; fehler: string[] }> | null> => pollUntil(cdp, `
      const bs = Array.from(document.querySelectorAll(".markdown-preview-view .svg-studio-block"));
      if (bs.length < ${String(n)}) return null;
      return bs.map((b) => { const i = b.querySelector("img.svg-studio-img"); const h = b.querySelector(".svg-studio-held p"); const k = b.querySelector("button.svg-studio-show");
        return { imgs: b.querySelectorAll("img.svg-studio-img").length, nw: i ? i.naturalWidth : 0, held: h ? h.innerText : null, knopf: k ? k.innerText : null, fehler: Array.from(b.querySelectorAll(".svg-studio-error li")).map((l) => l.innerText) }; });
    `, 10000, 250);
    const erst = await zustand(bloecke.length);
    if (erst === null) throw new Vorbedingung("Guard.md: nicht alle fünf Blöcke wurden gerendert");
    // Der Block nahe der Grenze wartet; sein Klick zeichnet ihn (gemessen: kein Hänger, das Bild hat eine Breite).
    const geklickt = await klick(`document.querySelectorAll(".markdown-preview-view .svg-studio-block")[3].querySelector("button.svg-studio-show")`);
    await sleep(1500);
    const nach = await zustand(bloecke.length);
    const quellen = await cdp.evaluate<string>(`return JSON.stringify(window.__quellen);`);
    const imVault = await liesDatei("Guard.md");
    const bomImVault = (imVault?.match(/\uFEFF/g) ?? []).length;
    const parser = await cdp.evaluate<string>(`
      const kl = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/></svg>';
      const p = (t) => { const d = new DOMParser().parseFromString(t, "image/svg+xml"); return d.getElementsByTagName("parsererror").length ? "parse-error" : "ok"; };
      return JSON.stringify({ ua: navigator.userAgent.replace(/^.*(Obsidian\\/\\S+).*(Chrome\\/\\S+).*$/, "$1 $2"), keins: p(kl), eins: p("\\uFEFF" + kl), zwei: p("\\uFEFF\\uFEFF" + kl), leerraumDavor: p(" " + kl), leerraumNachBom: p("\\uFEFF " + kl) });`);
    console.log(`  DOMParser in Obsidian (Text mit führendem U+FEFF): ${parser}`);
    console.log(`  Quellen beim Prozessor (erste drei Zeichen | Länge): ${quellen} · BOM im Vault-Text: ${String(bomImVault)}`);
    const [bom, bom2, teuer, nah, kl] = erst;
    // Das BOM kommt wirklich beim Plugin an (die Quelle, die `begin` sieht, beginnt mit U+FEFF) und der Block wird gezeichnet. Das zweite BOM ist keine Gegenprobe mehr: Obsidians Electron
    // (Chrome 142) lässt `DOMParser` ein einzelnes führendes U+FEFF durch, Chrome 153 (Messung des Kits) nicht; der Bereiniger nimmt den Block mit zwei BOM dort an (gemessen, siehe Ausgabe oben).
    const quellenListe = JSON.parse(quellen) as string[];
    const bomAngekommen = quellenListe.some((x) => x.startsWith("feff,3c,"));
    const gutBom = bomAngekommen && bom.imgs === 1 && bom.nw > 0 && bom.held === null && bom.fehler.length === 0;
    record("block-bom-und-kosten-im-block", gutBom
      && teuer.imgs === 0 && teuer.fehler.length === 1 && /^too-costly: this SVG would take too long to draw \(about \d+(\.\d)? times the allowed cost\)\. /.test(teuer.fehler[0]) && teuer.fehler[0].includes("fewer nested masks")
      && nah.imgs === 0 && nah.held !== null && /expensive to draw \(about \d+ % of the allowed cost\)/.test(nah.held) && nah.knopf === "Show"
      && kl.imgs === 1 && kl.nw > 0 && kl.held === null
      && geklickt && nach !== null && nach[3].imgs === 1 && nach[3].nw > 0 && nach[3].held === null,
    `ein BOM (angekommen: ${String(bomAngekommen)}): ${q(bom)} · zwei BOM (Hinweis, Ergebnis hängt von der Chromium-Version ab): ${q(bom2)} · zu teuer: ${q(teuer)} · nahe der Grenze: ${q(nah)} → nach Klick (${String(geklickt)}) ${q(nach?.[3])} · klein: ${q(kl)}`);
  });
}

/**
 * (Anderer Text als im Punkt davor: die Freigabe gilt je Text und Sitzung.) Der Stift im Platzhalter eines teuren Blocks (Opus-Delta-Check 2026-11-05, Befund 1): das Panel zeichnet den Text nicht von selbst, sondern zeigt einen Platzhalter mit „Show“; der Klick zeichnet die Vorschau
 * und gibt den Text frei, danach zeichnet auch der Block ohne weiteren Klick (gemeinsamer Zustand im Wächter).
 */
async function punktPanelTeuerBraucht(): Promise<void> {
  await lauf("panel-teurer-text-braucht-klick", async () => {
    await raeume();
    await stelleFixturenHer();
    await setPluginSetting(cdp, PLUGIN_ID, "autoShow", true);
    await cdp.evaluate(`${PLUGIN_MARKEN}.write([]); return true;`);
    await schreibe("Teuer.md", `# Teuer\n\n\`\`\`svg-studio\n${kostenSvg(720, 500)}\n\`\`\`\n`);
    if (!(await openExisting(cdp, "Teuer.md", "preview"))) throw new Vorbedingung("Teuer.md rendert nicht");
    const block = (): Promise<{ imgs: number; held: string | null } | null> => pollUntil(cdp, `
      const b = document.querySelector(".markdown-preview-view .svg-studio-block"); if (!b) return null;
      const h = b.querySelector(".svg-studio-held p"); return { imgs: b.querySelectorAll("img.svg-studio-img").length, held: h ? h.innerText : null };`, 8000, 250);
    const erst = await block();
    const stift = `document.querySelector(".markdown-preview-view .svg-studio-block > .svg-studio-edit")`;
    const gestiftet = await klick(stift);
    const ziel = await warteSnap((x) => /Teuer\.md:\d+/.test(x.target ?? ""), 8000);
    const panel = (): Promise<{ held: string | null; knopf: string | null; stage: number } | null> => pollUntil(cdp, `
      const p = document.querySelector(".svg-studio-panel"); if (!p) return null;
      const h = p.querySelector(".svg-studio-held p"); const k = p.querySelector(".svg-studio-held button.svg-studio-show");
      return h ? { held: h.innerText, knopf: k ? k.innerText : null, stage: p.querySelectorAll(".svg-studio-stage").length } : null;`, 8000, 250);
    const imPanel = await panel();
    const geklickt = await klick(`document.querySelector(".svg-studio-panel .svg-studio-held button.svg-studio-show")`);
    const gezeichnet = await pollUntil<boolean>(cdp, `const st = document.querySelector(".svg-studio-panel .svg-studio-stage"); return st && st.shadowRoot && st.shadowRoot.querySelector("svg") ? true : null;`, 8000, 250);
    // Gemeinsamer Zustand: der Block derselben Notiz zeichnet nach dem Neuaufbau ohne Klick.
    await oeffneNotizNeu("Teuer.md");
    const danach = await block();
    record("panel-teurer-text-braucht-klick",
      erst !== null && erst.imgs === 0 && erst.held !== null && gestiftet && ziel !== null
      && imPanel !== null && imPanel.stage === 0 && imPanel.knopf === "Show" && /the preview is shown only after a click/.test(imPanel.held ?? "")
      && geklickt && gezeichnet === true
      && danach !== null && danach.imgs === 1 && danach.held === null,
    `Block ${q(erst)} · Stift (${String(gestiftet)}) → Ziel ${q(ziel?.target)} · Panel ${q(imPanel)} · nach „Show“ (Klick ${String(geklickt)}) gezeichnet: ${String(gezeichnet)} · Block danach ${q(danach)}`);
  });
}

/** Eine andere Notiz und dann die genannte öffnen, damit der Block sicher neu gerendert wird. */
async function oeffneNotizNeu(pfad: string): Promise<void> {
  if (!(await openExisting(cdp, "Einbettung.md", "preview"))) throw new Vorbedingung("Einbettung.md rendert nicht");
  if (!(await openExisting(cdp, pfad, "preview"))) throw new Vorbedingung(`${pfad} rendert nicht`);
}

/**
 * Der Hänger des Ernstfalls. Echte Hänger kann der Bereiniger seit code-kit 0.58.0 kaum noch durchlassen: das alte Fixture (1000 `:has()`-Regeln über 4800 Elemente, 27 s) lehnt er mit `too-costly` ab,
 * und die Stil- und Layoutarbeit ist auf etwa eine Sekunde begrenzt. Was er annimmt und in Chromium 153 mit Software-Raster Sekunden braucht (`clip-path: polygon()` mit 6000 Punkten auf 2000 Rechtecken:
 * 12,3 s, Kostenwert 2083), friert Obsidian NICHT ein: im echten Obsidian gemessen 2026-11-05 (16 s Beobachtung) größte Timerlücke 298 ms, größte Framelücke 250 ms, das Raster läuft außerhalb des Hauptthreads.
 * Deshalb friert der Test selbst ein: `einfrierer()` blockiert den Hauptthread beim Setzen der `src` eines SVG-Bildes 12 s (die Stelle, an der ein echter Hänger zuschlägt, nach `begin`). Der Text des Blocks ist
 * ein kleines, gültiges SVG; das Urteil gilt der Kette Marke, Beenden, Neustart, Platzhalter, nicht dem Kostenmodell.
 */
function haengerSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Haenger-Probe</title><rect id="h" x="1" y="1" width="8" height="8" fill="#c33"/></svg>`;
}

/** Ausdruck für den Renderer: friert den Hauptthread für `ms` ein, sobald ein SVG-Bild seine `src` bekommt (einmal je Fenster). */
const einfrierer = (ms: number): string => `
  if (!window.__einfrierer) {
    window.__einfrierer = true;
    const orig = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (this instanceof HTMLImageElement && name === "src" && String(value).startsWith("data:image/svg+xml")) { const t = performance.now(); while (performance.now() - t < ${String(ms)}) { /* Hauptthread blockiert */ } }
      return orig.call(this, name, value);
    };
  }
  return true;`;

/** Zeigt der Block, was der Wächter schützen soll: Zustand des Blocks in der Notiz, die Marken im Speicher des Plugins. */
const PLUGIN_MARKEN = `app.plugins.plugins[${q(PLUGIN_ID)}].markStore`;

/** Die eigene Zweitinstanz hart beenden (`kill -9` über den vollen Profilpfad, nie die reguläre Instanz) und neu starten; liefert die neue Verbindung. */
async function hartNeustart(ud: string, signal: "-9" | "-TERM" | "browser-close" = "-9"): Promise<Cdp> {
  const beende = (sig: string): void => { try { execFileSync("pkill", [sig, "-f", `user-data-dir=${ud}`]); } catch { /* nichts mehr da */ } };
  if (signal === "browser-close") {
    // Geordnetes Beenden über das DevTools-Protokoll des Browser-Ziels (wie ein „Beenden“ aus dem Programm, nicht wie ein Signal).
    try {
      const v = (await (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).json()) as { webSocketDebuggerUrl: string };
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise<void>((res) => { ws.onopen = () => { res(); }; ws.onerror = () => { res(); }; });
      ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    } catch { /* der Aufrufer sieht, ob der Prozess lebt */ }
  }
  const lebt = (): boolean => { try { execFileSync("pgrep", ["-f", `user-data-dir=${ud}`]); return true; } catch { return false; } };
  if (signal !== "browser-close") beende(signal);
  // Geordnetes Beenden (SIGTERM) darf dauern; ein Prozess, der nach 15 s noch lebt, wird dann doch hart beendet (der Aufrufer kennt das über `geordnet`).
  for (let i = 0; i < 30; i++) {
    if (!lebt()) break;
    await sleep(500);
  }
  if (lebt()) { beende("-9"); for (let i = 0; i < 30 && lebt(); i++) await sleep(500); }
  const app = spawn("/Applications/Obsidian.app/Contents/MacOS/Obsidian", [`--user-data-dir=${ud}`, `--remote-debugging-port=${String(port)}`, "--lang=en-US"], { detached: true, stdio: "ignore" });
  app.unref();
  let neu: Cdp | null = null;
  for (let i = 0; i < 40 && neu === null; i++) {
    await sleep(1000);
    neu = await attachTo("workspace", port, REPO_NAME).catch(() => null);
  }
  if (neu === null) throw new Vorbedingung("Die Zweitinstanz kam nach dem Beenden nicht wieder");
  return neu;
}

/**
 * Beenden im Wachfenster (Opus-Review 2026-11-05, Befund 4): ein harmloses Bild wird gezeichnet, Obsidian wird geordnet beendet (SIGTERM und `Browser.close`), solange der Wächter
 * noch beobachtet (700 ms von rund 2 s). Das Review hatte in Headless-Chromium gemessen, dass das Löschen der Marke in IndexedDB beim Schließen des Fensters verloren geht
 * (`beforeunload` + `window.close()` 0 von 3) und einen Fehlalarm beim nächsten Start vermutet. In Obsidian ist es nicht so: die Fenster-Ereignisse laufen (beforeunload,
 * pagehide, visibilitychange, unload), und die Marke der alten Sitzung ist nach dem Neustart weg. Dieser Punkt hält das fest. Kontrollschlüssel: ein Schlüssel in localStorage
 * zeigt, dass das Beenden geordnet war (sonst „nichts gemessen“). Die Marke des NEUEN Prozesses zählt nicht (er stellt die Notiz wieder her und setzt eine eigene).
 */
async function punktBeendenImWachfenster(): Promise<boolean> {
  let neuGestartet = false;
  await lauf("laufzeit-beenden-im-wachfenster", async () => {
    const ud = process.env.UD ?? "";
    if (!ud.startsWith("/tmp/obs-test-")) throw new Vorbedingung("nur über messlauf.sh (UD fehlt oder ist kein Wegwerfprofil)");
    const quelle = blockQuelle(fixtur("Block.md"));
    const fp = createHash("sha256").update(quelle, "utf8").digest("hex");
    const ergebnisse: string[] = [];
    let alleGut = true;
    let geordnet = 0;
    for (const art of ["-TERM", "browser-close"] as const) {
      await raeume();
      await stelleFixturenHer();
      await setPluginSetting(cdp, PLUGIN_ID, "autoShow", true);
      await requireVisible(cdp);
      // Fühler: welche Fenster-Ereignisse laufen beim Beenden wirklich (roher localStorage, damit er nichts mit dem Plugin teilt), und ein Kontrollschlüssel für das geordnete Festschreiben.
      await cdp.evaluate(`
        ${PLUGIN_MARKEN}.write([]);
        localStorage.setItem("sstudio-quit-events", "[]");
        app.saveLocalStorage("svg-studio:quit-probe", ${q(String(Date.now()))});
        const log = (n) => { try { const a = JSON.parse(localStorage.getItem("sstudio-quit-events") || "[]"); a.push(n); localStorage.setItem("sstudio-quit-events", JSON.stringify(a)); } catch (e) { /* nichts */ } };
        for (const e of ["beforeunload", "pagehide", "unload", "visibilitychange"]) window.addEventListener(e, () => log(e));
        return true;`);
      await cdp.evaluate(`const f = app.vault.getAbstractFileByPath("Block.md"); setTimeout(() => { app.workspace.getLeaf("tab").openFile(f, { state: { mode: "preview" } }); }, 0); return true;`);
      await sleep(700);
      const alt = JSON.parse(await cdp.evaluate<string>(`return JSON.stringify(${PLUGIN_MARKEN}.read().map((m) => ({ fp: m.fp, session: m.session })));`)) as Array<{ fp: string; session: string }>;
      const sAlt = alt.find((m) => m.fp === fp)?.session ?? null;
      if (sAlt === null) throw new Vorbedingung(`Vor dem Beenden stand keine Marke für den Block: ${JSON.stringify(alt)}`);
      neuGestartet = true;
      cdp = await hartNeustart(ud, art);
      const z = await cdp.evaluate<string>(`return JSON.stringify({ kontrolle: app.loadLocalStorage("svg-studio:quit-probe"), ereignisse: localStorage.getItem("sstudio-quit-events"), marken: ${PLUGIN_MARKEN}.read().map((m) => ({ fp: m.fp, slow: m.slow === true, session: m.session })) });`);
      const o = JSON.parse(z) as { kontrolle: string | null; ereignisse: string | null; marken: Array<{ fp: string; session: string; slow: boolean }> };
      const marke = o.marken.some((x) => x.fp === fp && x.session === sAlt);
      ergebnisse.push(`${art}: Ereignisse ${o.ereignisse ?? "—"}, Kontrollschlüssel ${o.kontrolle === null ? "FEHLT" : "da"}, Marke der alten Sitzung ${sAlt} nach dem Neustart ${marke ? "DA (Fehlalarm)" : "weg"}`);
      await bereiteVor(cdp);
      if (o.kontrolle === null) continue; // das Beenden schrieb nichts fest: für diese Art nichts zu messen
      geordnet++;
      if (marke) alleGut = false;
    }
    if (geordnet === 0) throw new Vorbedingung(`Kein Beenden war geordnet (Kontrollschlüssel fehlt überall): ${ergebnisse.join(" · ")}`);
    record("laufzeit-beenden-im-wachfenster", alleGut, ergebnisse.join(" · "));
  });
  return neuGestartet;
}

/**
 * Laufzeit-Schutz, der Ernstfall: ein angenommenes SVG friert Obsidian ein, die Instanz wird hart beendet, nach dem Neustart zeichnet der Block nicht mehr, sondern bietet
 * „Trotzdem anzeigen“. Zwei Kill-Zeitpunkte (0,3 s und 1,5 s nach dem Öffnen). Streng (Opus-Review 2026-11-05): die gefundene Marke muss VOR dem Kill geschrieben sein
 * (Zeit aus dem Test), der Neustart darf nicht hängen, und die Gegenprobe zeigt, dass ohne Marke der Hänger wirklich entsteht.
 */
async function punktAbsturzNeustart(): Promise<boolean> {
  let neuGestartet = false;
  await lauf("laufzeit-absturz-neustart", async () => {
    const ud = process.env.UD ?? "";
    if (!ud.startsWith("/tmp/obs-test-")) throw new Vorbedingung("nur über messlauf.sh (UD fehlt oder ist kein Wegwerfprofil)");
    const haenger = haengerSvg();
    const fp = createHash("sha256").update(haenger, "utf8").digest("hex");
    const notiz = `# Hänger-Probe\n\n\`\`\`svg-studio\n${haenger}\n\`\`\`\n\nText nach dem Block.\n`;
    const befunde: string[] = [];
    let alleGut = true;
    const marken = (): Promise<string> => cdp.evaluate<string>(`return JSON.stringify(${PLUGIN_MARKEN}.read().map((m) => ({ fp: m.fp, at: m.at, slow: m.slow === true, session: m.session })));`);

    await raeume();
    await stelleFixturenHer();
    await setPluginSetting(cdp, PLUGIN_ID, "autoShow", true);
    // Ein verdecktes Fenster zeichnet nicht, und dann hängt auch nichts: der Punkt braucht das Fenster vorn.
    await requireVisible(cdp);
    await schreibe("Haenger.md", notiz);

    // Vorprobe ohne Beenden: mit einer Marke einer früheren Sitzung darf der Hänger-Block den Renderer nicht einfrieren (nur der Platzhalter entsteht).
    await cdp.evaluate(einfrierer(12000));
    await cdp.evaluate(`${PLUGIN_MARKEN}.write([{ fp: ${q(fp)}, at: Date.now(), session: "frueher" }]); return true;`);
    await cdp.evaluate(`const f = app.vault.getAbstractFileByPath("Haenger.md"); setTimeout(() => { app.workspace.getLeaf("tab").openFile(f, { state: { mode: "preview" } }); }, 50); return true;`);
    await sleep(3000);
    const vorprobe = await Promise.race([cdp.evaluate<string>(`const b = document.querySelector(".markdown-preview-view .svg-studio-block"); return JSON.stringify({ imgs: b ? b.querySelectorAll("img").length : -1, held: b ? !!b.querySelector(".svg-studio-held") : null });`).catch((e) => `Fehler ${fehlerText(e)}`), sleep(8000).then(() => "keine Antwort in 8 s (Renderer hängt)")]);
    console.log(`  Vorprobe (Marke einer früheren Sitzung gesetzt, Block geöffnet): ${vorprobe}`);
    if (!vorprobe.includes('"held":true')) {
      record("laufzeit-absturz-neustart", false, `schon die Vorprobe scheitert: mit einer fremden Marke zeigt der Hänger-Block keinen Platzhalter: ${vorprobe}`);
      return;
    }

    for (const killNach of [300, 1500]) {
      await cdp.evaluate(`${PLUGIN_MARKEN}.write([]); return true;`);
      await raeume();
      await stelleFixturenHer();
      await schreibe("Haenger.md", notiz);
      await requireVisible(cdp);
      await cdp.evaluate(einfrierer(12000));
      const tOffen = Date.now();
      // Öffnen, ohne zu warten: der Einfrierer blockiert den Hauptthread, sobald das Bild seine src bekommt (12 s).
      await cdp.evaluate(`const f = app.vault.getAbstractFileByPath("Haenger.md"); setTimeout(() => { app.workspace.getLeaf("tab").openFile(f, { state: { mode: "preview" } }); }, 0); return true;`);
      await sleep(killNach);
      const tKill = Date.now();
      neuGestartet = true;
      cdp = await hartNeustart(ud);
      // Sofort nach dem Wiederverbinden: der Neustart darf nicht hängen (Zeitüberschreitung ist rot), und die Marke muss VOR dem Kill geschrieben sein.
      const start = await Promise.race([
        cdp.evaluate<string>(`return JSON.stringify({ marken: ${PLUGIN_MARKEN}.read().map((m) => ({ fp: m.fp, at: m.at, slow: m.slow === true, session: m.session })), offen: app.workspace.getLeavesOfType("markdown").map((l) => l.view.file && l.view.file.path) });`).catch((e) => `Fehler ${fehlerText(e)}`),
        sleep(25000).then(() => "KEINE ANTWORT in 25 s (der Neustart hängt: die Absturzschleife)"),
      ]);
      let gut = false;
      let grund = start;
      if (!start.startsWith("KEINE") && !start.startsWith("Fehler")) {
        const z = JSON.parse(start) as { marken: Array<{ fp: string; at: number; slow: boolean; session: string }>; offen: string[] };
        const m = z.marken.find((x) => x.fp === fp);
        gut = m !== undefined && m.session !== "" && m.at >= tOffen && m.at <= tKill;
        grund = m === undefined ? `keine Marke für den Hänger-Block (Marken ${q(z.marken.length)}, offen ${q(z.offen)})` : `(Notiz beim Start offen: ${q(z.offen)}) Marke geschrieben ${String(m.at - tOffen)} ms nach dem Öffnen, ${String(tKill - m.at)} ms vor dem Kill (${gut ? "vor dem Kill" : "NACH dem Kill, vom neuen Prozess"}), Sitzung ${m.session}, slow ${String(m.slow)}`;
      }
      befunde.push(`Kill ${String(killNach)} ms nach dem Öffnen: ${grund}`);
      if (!gut) { alleGut = false; continue; }
      await bereiteVor(cdp);
      if (!(await openExisting(cdp, "Haenger.md", "preview"))) { alleGut = false; befunde.push("Haenger.md rendert nach dem Neustart nicht"); continue; }
      const nach = await blockZustand();
      const platzhalter = nach !== null && nach.imgs === 0 && nach.held !== null && nach.knopf !== null;
      befunde.push(`Block nach dem Neustart ${q(nach)}`);
      if (!platzhalter) alleGut = false;
    }

    // Gegenprobe: dieselbe Notiz ohne Marke hängt (sonst hätte der Test den Hänger gar nicht erzeugt). „Trotzdem anzeigen“ löscht die Marke und zeichnet.
    let gegenprobe = "nicht gemessen";
    if (alleGut) {
      await cdp.evaluate(einfrierer(12000));
      // Lückenmesser im Fenster: größte Verspätung eines 20-ms-Timers und größter Abstand zweier Frames (rAF) ab dem Klick; er läuft 16 s und wird danach gelesen.
      await cdp.evaluate(`window.__luecken = { timer: 0, raf: 0 }; let lt = performance.now(), lr = performance.now(); const iv = setInterval(() => { const n = performance.now(); window.__luecken.timer = Math.max(window.__luecken.timer, n - lt); lt = n; }, 20); const f = () => { const n = performance.now(); window.__luecken.raf = Math.max(window.__luecken.raf, n - lr); lr = n; requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => clearInterval(iv), 16000); return true;`);
      await cdp.evaluate(`const b = document.querySelector(".markdown-preview-view .svg-studio-block button.svg-studio-show"); setTimeout(() => { if (b) b.click(); }, 0); return !!b;`);
      const antwortet = await Promise.race([sleep(2000).then(() => cdp.evaluate<number>(`return 1;`)).then(() => true, () => false), sleep(6000).then(() => false)]);
      await sleep(14000);
      const luecken = await Promise.race([cdp.evaluate<string>(`return JSON.stringify(window.__luecken);`).catch(() => "Fehler"), sleep(30000).then(() => "keine Antwort")]);
      gegenprobe = `${antwortet ? "Renderer blieb ansprechbar (der Test erzeugt keinen Hänger)" : "Renderer hängt, wie erwartet"} · größte Lücke ${luecken}`;
      if (antwortet) alleGut = false;
    }
    record("laufzeit-absturz-neustart", alleGut, `${befunde.join(" · ")} · Gegenprobe (Marke gelöscht, Block gezeichnet): ${gegenprobe}`);
  });
  return neuGestartet;
}

async function punktEinbettung(): Promise<void> {
  await lauf("einbettung-hat-knopf", async () => {
    await raeume();
    await stelleFixturenHer();
    type Knopf = { n: number; knoepfe: number; w: number; h: number; label: string | null };
    const messe = async (scope: string): Promise<Knopf | null> => {
      const ende = Date.now() + 8000;
      let r: Knopf | null = null as Knopf | null;
      while (Date.now() < ende) {
        r = await cdp.evaluate<Knopf | null>(`
          ${SICHTBAR}
          const es = Array.from(document.querySelectorAll(${q(`${scope} .internal-embed.image-embed`)})).filter(vis);
          if (es.length === 0) return null;
          const bs = es[0].querySelectorAll("[data-svg-studio-button]");
          const b = bs[0];
          const rr = b ? b.getBoundingClientRect() : null;
          return { n: es.length, knoepfe: bs.length, w: rr ? Math.round(rr.width) : 0, h: rr ? Math.round(rr.height) : 0, label: b ? b.getAttribute("aria-label") : null };
        `);
        if (r !== null && r.knoepfe >= 1) break;
        await sleep(250);
      }
      return r;
    };
    if (!(await openExisting(cdp, "Einbettung.md", "preview"))) throw new Vorbedingung("Einbettung.md (Lesemodus) rendert nicht");
    const lesen = await messe(".markdown-preview-view");
    if (!(await openExisting(cdp, "Einbettung.md", "source"))) throw new Vorbedingung("Einbettung.md (Live Preview) rendert nicht");
    const lp = await messe(".markdown-source-view");
    const gut = (m: typeof lesen): boolean => m !== null && m.n === 1 && m.knoepfe === 1 && m.w > 0 && m.h > 0 && m.label !== null;
    record("einbettung-hat-knopf", gut(lesen) && gut(lp), `nur die sichtbare Fassung · Lesemodus ${q(lesen)} · Live Preview ${q(lp)}`);
  });
}

async function punktKnopfOeffnetPanel(): Promise<void> {
  await lauf("knopf-oeffnet-panel", async () => {
    await raeume();
    await stelleFixturenHer();
    if (!(await openExisting(cdp, "Einbettung.md", "preview"))) throw new Vorbedingung("Einbettung.md rendert nicht");
    const knopfE = `Array.from(document.querySelectorAll(".markdown-preview-view .internal-embed.image-embed [data-svg-studio-button]")).find((b) => b.getBoundingClientRect().width > 0)`;
    await pollUntil(cdp, `return (${knopfE}) ? true : null;`, 8000, 250);
    if (!(await klick(`(${knopfE})`))) throw new Vorbedingung("Einbettungsknopf nicht klickbar");
    const e = await warteSnap((s) => (s.target ?? "").includes("probe.svg"), 8000);
    const blaetter = await cdp.evaluate<number>(`return app.workspace.getLeavesOfType(${q(VIEW_TYPE)}).length;`);
    if (!(await openExisting(cdp, "Block.md", "preview"))) throw new Vorbedingung("Block.md rendert nicht");
    const knopfB = `Array.from(document.querySelectorAll(".markdown-preview-view .svg-studio-block > .svg-studio-edit")).find((b) => b.getBoundingClientRect().width > 0)`;
    await pollUntil(cdp, `return (${knopfB}) ? true : null;`, 8000, 250);
    if (!(await klick(`(${knopfB})`))) throw new Vorbedingung("Blockknopf nicht klickbar");
    const b = await warteSnap((s) => /Block\.md:\d+/.test(s.target ?? ""), 8000);
    const blaetter2 = await cdp.evaluate<number>(`return app.workspace.getLeavesOfType(${q(VIEW_TYPE)}).length;`);
    record("knopf-oeffnet-panel", e !== null && b !== null && blaetter === 1 && blaetter2 === 1, `Einbettung: Ziel ${q(e?.target)} (${blaetter} Blatt) · Block: Ziel ${q(b?.target)} (${blaetter2} Blatt)`);
  });
}

async function punktSchnappschuss(): Promise<void> {
  await lauf("c4d-schnappschuss", async () => {
    await raeume();
    await stelleFixturenHer();
    await loescheSchnappschuesse();
    // 8 Schnappschüsse von früher am Tag: mit dem neuen sind es 9, die Staffelung (6 heute, dazu der älteste) behält 7.
    const wurzel = await schnappschussWurzel();
    const alt = fixtur("probe.svg");
    const jetzt = Date.now();
    const saat: string[] = [];
    for (let i = 8; i >= 1; i--) saat.push(stampedName(jetzt - (i + 2) * 60_000));
    for (const name of saat) {
      await cdp.evaluate(`
        const dir = ${q(`${wurzel}/${name}`)};
        await app.vault.adapter.mkdir(${q(wurzel)}).catch(() => undefined);
        await app.vault.adapter.mkdir(dir);
        await app.vault.adapter.write(dir + "/probe.svg", ${q(alt)});
        return true;
      `);
    }
    if (!(await openExisting(cdp, "Einbettung.md", "preview"))) throw new Vorbedingung("Einbettung.md rendert nicht");
    const knopf = `Array.from(document.querySelectorAll(".markdown-preview-view .internal-embed.image-embed [data-svg-studio-button]")).find((b) => b.getBoundingClientRect().width > 0)`;
    await pollUntil(cdp, `return (${knopf}) ? true : null;`, 8000, 250);
    if (!(await klick(`(${knopf})`))) throw new Vorbedingung("Einbettungsknopf nicht klickbar");
    if ((await warteSnap((s) => (s.target ?? "").includes("probe.svg"), 8000)) === null) throw new Vorbedingung("Panel nicht auf probe.svg");
    stub.antworten([ANTWORT_VERFEINERN]);
    const s = await frage(PROMPT_VERFEINERN);
    console.log(`    Runde: ${q(s.labels)} ${q(s.metas)} · Änderungen ${q(s.changes)} · ${s.measure ?? "(keine Maßzeile)"}`);
    await nimmBilder("desktop").catch((e) => console.log(`    ! Bilder: ${fehlerText(e)}`));
    const r = await uebernimm();
    const neu = await liesDatei("probe.svg");
    const liste = await cdp.evaluate<string[]>(`
      const w = ${q(wurzel)};
      if (!(await app.vault.adapter.exists(w))) return [];
      return (await app.vault.adapter.list(w)).folders.map((f) => f.split("/").pop());
    `);
    const neuester = [...liste].sort().at(-1) ?? "";
    const kopie = neuester === "" ? null : await liesDatei(`${wurzel}/${neuester}/probe.svg`).catch(() => null);
    const kopieDirekt = neuester === "" ? null : await cdp.evaluate<string | null>(`const p = ${q(`${wurzel}/${neuester}/probe.svg`)}; return (await app.vault.adapter.exists(p)) ? await app.vault.adapter.read(p) : null;`);
    const geschrieben = neu !== null && neu.includes('x="145"') && !neu.includes('x="165"');
    const gesichert = kopieDirekt !== null && kopieDirekt === alt && !saat.includes(neuester);
    const rotiert = liste.length < 9 && saat.slice(0, 1).every((n) => liste.includes(n)) && liste.length >= 2;
    void kopie;
    record("c4d-schnappschuss", r.ok && geschrieben && gesichert && rotiert,
      `Übernehmen ${r.ok ? "ok" : `Fehler: ${r.snap.status}`} · Datei geändert (Tür x=145): ${geschrieben} · Kopie des alten Standes im neuesten Ordner ${q(neuester)}: ${gesichert} · Rotation: ${liste.length} von 9 Ordnern übrig, ältester da: ${saat.slice(0, 1).every((n) => liste.includes(n))}`);
    await loescheSchnappschuesse();
    await schreibe("probe.svg", fixtur("probe.svg"));
  });
}

async function punktErzeugen(): Promise<void> {
  await lauf("erzeugen-ersatzendpunkt", async () => {
    await raeume();
    await oeffneNeuesPanel();
    stub.antworten([ANTWORT_ERZEUGEN]);
    const s = await frage(PROMPT_ERZEUGEN);
    const chats = chatAnfragen();
    const modell = (chats[0]?.json as { model?: string } | null)?.model;
    const ids = s.svgIds ?? [];
    record("erzeugen-ersatzendpunkt",
      s.rounds === 1 && !s.previewHidden && ids.includes("tuer") && ids.includes("raum") && chats.length === 1 && modell === "stub-modell" && (s.measure ?? "") !== "",
      `Runde ${q(s.labels)} (${q(s.metas)}) · Vorschau zeigt ${ids.length} Elemente mit id (tuer: ${ids.includes("tuer")}) · Maßzeile ${q(s.measure)} · Status ${q(s.status)} · Stub: ${chats.length} Chat-Anfrage, Modell ${q(modell)} (gegen den Stub, nicht gegen ein Modell)`);
  });
}

async function punktRueckfrage(): Promise<void> {
  await lauf("rueckfrage-nach-ungueltiger-antwort", async () => {
    await raeume();
    await oeffneNeuesPanel();
    stub.antworten([ANTWORT_UNGUELTIG, ANTWORT_ERZEUGEN]);
    const s = await frage(PROMPT_ERZEUGEN);
    const chats = chatAnfragen();
    const zweite = chats[1] ? nachrichten(chats[1]) : [];
    const letzte = zweite.at(-1)?.content ?? "";
    const ok = chats.length === 2 && nachrichten(chats[0]!).length === 2 && zweite.length === 4 && letzte.startsWith("Your previous answer was not valid:") && letzte.includes("Kommentare in <style>");
    record("rueckfrage-nach-ungueltiger-antwort", ok && s.rounds === 1 && (s.svgIds ?? []).includes("tuer"),
      `${chats.length} Anfragen im Stub-Protokoll · Nachrichten je Anfrage ${q(chats.map((c) => nachrichten(c).length))} · Rückfrage beginnt ${q(letzte.slice(0, 120))} · am Ende ${s.rounds} Runde mit tuer: ${(s.svgIds ?? []).includes("tuer")}`);
  });
}

async function punktSchattenwurzel(): Promise<void> {
  await lauf("schattenwurzel-isoliert", async () => {
    await raeume();
    await oeffneNotiz("_smoke-schatten.md", "Eine Notiz neben dem Panel.\n", "preview");
    await oeffneNeuesPanel();
    const FARBEN = `
      const farbe = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; };
      return { knopf: farbe(".svg-studio-send"), ziel: farbe(".svg-studio-target"), flaeche: farbe(".workspace-split.mod-root"), notiz: farbe(".markdown-preview-view"), body: farbe("body") };
    `;
    type Farben = { knopf: string | null; ziel: string | null; flaeche: string | null; notiz: string | null; body: string | null };
    const vorher = await cdp.evaluate<Farben>(FARBEN);
    stub.antworten([ANTWORT_STIL]);
    const s = await frage("Ein Kasten mit rotem Stil");
    if (s.error !== null) throw new Vorbedingung(`Der Bereiniger lehnt das Stil-SVG ab: ${s.error}`);
    const nachher = await cdp.evaluate<Farben>(FARBEN);
    const innen = await cdp.evaluate<string | null>(`const st = document.querySelector(".svg-studio-stage"); const svg = st && st.shadowRoot ? st.shadowRoot.querySelector("svg") : null; return svg ? getComputedStyle(svg).color : null;`);
    const stilDa = await cdp.evaluate<boolean>(`const st = document.querySelector(".svg-studio-stage"); return !!(st && st.shadowRoot && st.shadowRoot.querySelector("style") && Array.from(st.shadowRoot.querySelectorAll("style")).some((x) => (x.textContent || "").includes("color: red")));`);
    // Gegenprobe: dieselbe Regel im Licht-DOM (mit !important, denn `*` hat keine Spezifität und verliert gegen die eigene Farbregel des Knopfs) färbt Knopf und Zieltext — die Messung kann also rot werden.
    await cdp.evaluate(`const st = document.createElement("style"); st.id = "smoke-leck"; st.textContent = "* { color: red !important }"; document.head.appendChild(st); return true;`);
    const leck = await cdp.evaluate<Farben>(FARBEN);
    await cdp.evaluate(`const st = document.getElementById("smoke-leck"); if (st) st.remove(); return true;`);
    const gleich = vorher.knopf === nachher.knopf && vorher.ziel === nachher.ziel && vorher.flaeche === nachher.flaeche && vorher.notiz === nachher.notiz && vorher.body === nachher.body;
    const beisst = leck.knopf === "rgb(255, 0, 0)" && leck.ziel === "rgb(255, 0, 0)" && vorher.knopf !== "rgb(255, 0, 0)" && vorher.ziel !== "rgb(255, 0, 0)";
    if (!stilDa || innen !== "rgb(255, 0, 0)") throw new Vorbedingung(`Das <style> wirkt nicht einmal im Shadow Root (innen ${innen}, Stil da: ${stilDa}): der Punkt hätte keinen Gegenstand`);
    if (!beisst) throw new Vorbedingung(`Gegenprobe ohne Biss: im Licht-DOM färbt dieselbe Regel Knopf und Zieltext nicht (${leck.knopf}, ${leck.ziel})`);
    record("schattenwurzel-isoliert", gleich, `Knopf ${vorher.knopf} → ${nachher.knopf} · Zieltext ${vorher.ziel} → ${nachher.ziel} · Arbeitsfläche ${vorher.flaeche} → ${nachher.flaeche} · Notiz ${vorher.notiz} → ${nachher.notiz} · im Shadow Root color ${innen} (die Regel wirkt dort) · Gegenprobe (Regel mit !important im Licht-DOM): Knopf ${leck.knopf}, Zieltext ${leck.ziel}`);
  });
}

const ERREICHBAR = {
  selektoren: [".svg-studio-input", ".svg-studio-send", ".svg-studio-accept", ".svg-studio-discard", ".svg-studio-new", ".svg-studio-bg-toggle", ".okit-model-bar-select"],
  erforderlich: [".svg-studio-send", ".svg-studio-accept", ".svg-studio-discard", ".svg-studio-input"],
  fuelle: { in: ".svg-studio-stream .okit-stream-body", zeilen: 150 },
  ueberlauf: ".svg-studio-panel",
};
const KURZ = { element: ".workspace-leaf", enthaelt: ".svg-studio-panel", hoehe: 420 };

async function punktFokusUndErreichbarkeit(): Promise<void> {
  if (!gewaehlt("fokus-erhalt", "fokus-erhalt-gegenprobe", "erreichbarkeit", "erreichbarkeit-gegenprobe")) return;
  await raeume();
  await oeffneNeuesPanel();
  stub.antworten([{ text: ANTWORT_ERZEUGEN, takt: 150, teile: 30 }]);
  let laeuft = false;
  try {
    await tippe(PROMPT_ERZEUGEN);
    await klickSenden();
    laeuft = (await warteSnap((s) => s.running, 5000)) !== null;
  } catch (e) {
    console.log(`    ! Lauf nicht gestartet: ${fehlerText(e)}`);
  }
  await lauf("fokus-erhalt", async () => {
    if (!laeuft) throw new Vorbedingung("Der Lauf startete nicht (Fokus WÄHREND des Stroms nicht messbar)");
    const u = await messeFokusErhalt(cdp, { selector: ".svg-studio-input" });
    urteil("fokus-erhalt", { ...u, detail: `${u.detail} (getippt während des Stroms)` });
  });
  await warteSnap((s) => s.rounds === 1 && !s.running, 30000);
  await lauf("fokus-erhalt-gegenprobe", async () => {
    urteil("fokus-erhalt-gegenprobe", await gegenprobeFokus(cdp, { selector: ".svg-studio-input" }));
  });
  await lauf("erreichbarkeit", async () => {
    const s = await snap();
    if (s === null || s.rounds !== 1) throw new Vorbedingung("Keine Runde im Panel: die Vorschau fehlt");
    const u1 = await messeErreichbarkeit(cdp, ERREICHBAR);
    const u2 = await mitHoehe(cdp, KURZ, () => messeErreichbarkeit(cdp, ERREICHBAR));
    const teile = [u1, u2 as PflichtTeilurteil];
    const rot = teile.find((t) => t.urteil === "rot");
    const gruen = teile.filter((t) => t.urteil === "gruen").length;
    const gesamt: PflichtTeilurteil = rot !== undefined ? rot : gruen > 0 ? { urteil: "gruen", detail: "" } : { urteil: "nichts-gemessen", detail: "" };
    urteil("erreichbarkeit", { ...gesamt, detail: `normal: ${u1.urteil} (${u1.detail}) · kurzes Panel 420 px: ${(u2 as PflichtTeilurteil).urteil} (${(u2 as PflichtTeilurteil).detail})` });
  });
  await lauf("erreichbarkeit-gegenprobe", async () => {
    const g = await mitHoehe(cdp, KURZ, () => gegenprobeErreichbarkeit(cdp, ERREICHBAR));
    urteil("erreichbarkeit-gegenprobe", g as PflichtTeilurteil);
  });
}

async function punktUebernehmenDatei(): Promise<void> {
  await lauf("uebernehmen-als-datei", async () => {
    // Das Panel mit der Runde aus dem vorigen Abschnitt weiterverwenden, aber die Notiz neu hinlegen.
    const s0 = await snap();
    if (s0 === null || s0.rounds !== 1) {
      await raeume();
      await oeffneNeuesPanel();
      stub.antworten([ANTWORT_ERZEUGEN]);
      await frage(PROMPT_ERZEUGEN);
    }
    await oeffneNotiz("_smoke-datei.md", "Vorher\n\nNachher\n", "source");
    await setzeCursor("_smoke-datei.md", 2);
    const vor = await anhaenge();
    const r = await uebernimm();
    const nach = await anhaenge();
    const neu = nach.filter((p) => !vor.includes(p));
    const inhalt = neu[0] === undefined ? null : await liesDatei(neu[0]);
    await sleep(300);
    const notiz = (await notizText("_smoke-datei.md")) ?? "";
    const name = neu[0]?.split("/").pop() ?? "";
    record("uebernehmen-als-datei",
      r.ok && neu.length === 1 && neu[0]!.startsWith(`${ANHANG}/`) && inhalt !== null && inhalt.includes('id="tuer"') && name !== "" && notiz.includes(`![[${name}]]`) && (r.snap.target ?? "").includes(name),
      `Übernehmen ${r.ok ? "ok" : "Fehler"}: ${q(r.snap.status)} · neue Dateien ${q(neu)} · enthält tuer: ${inhalt?.includes('id="tuer"')} · Einbettung in der Notiz: ${notiz.includes(`![[${name}]]`)} · Panel-Ziel danach ${q(r.snap.target)}`);
  });
}

async function punktUebernehmenBlock(): Promise<void> {
  if (!gewaehlt("uebernehmen-als-block", "c4a-bediente-notiz", "strg-z-nach-block-uebernehmen")) return;
  await raeume();
  await setzeAcceptAs("block");
  await oeffneNotiz("_smoke-andere.md", "Eine andere Notiz.\n", "source");
  await oeffneNotiz("_smoke-block.md", "Vorher\n\nNachher\n", "source", "tab");
  await setzeCursor("_smoke-block.md", 2);
  await oeffneNeuesPanel();
  stub.antworten([ANTWORT_ERZEUGEN]);
  let fehler: string | null = null;
  try {
    await frage(PROMPT_ERZEUGEN);
  } catch (e) {
    fehler = fehlerText(e);
  }
  const vorX = await notizText("_smoke-block.md");
  const vorY = await notizText("_smoke-andere.md");
  const aktiv = await cdp.evaluate<string | null>(`const l = app.workspace.activeLeaf; return l && l.view ? l.view.getViewType() : null;`);
  let r: { ok: boolean; snap: Snap } | null = null;
  try {
    if (fehler === null) r = await uebernimm();
  } catch (e) {
    fehler = fehlerText(e);
  }
  await sleep(400);
  const nachX = await notizText("_smoke-block.md");
  const nachY = await notizText("_smoke-andere.md");
  await lauf("uebernehmen-als-block", async () => {
    if (fehler !== null || r === null) throw new Vorbedingung(`Vorbereitung fehlgeschlagen: ${fehler}`);
    const ok = r.ok && nachX !== null && nachX.includes("```svg-studio") && nachX.includes('id="tuer"') && /Code block inserted/.test(r.snap.status ?? "") && /_smoke-block/.test(r.snap.target ?? "");
    record("uebernehmen-als-block", ok, `Übernehmen ${r.ok ? "ok" : "Fehler"}: ${q(r.snap.status)} · Block in der Notiz: ${nachX?.includes("```svg-studio")} · Panel-Ziel danach ${q(r.snap.target)}`);
  });
  await lauf("c4a-bediente-notiz", async () => {
    if (fehler !== null || r === null) throw new Vorbedingung(`Vorbereitung fehlgeschlagen: ${fehler}`);
    record("c4a-bediente-notiz", aktiv === VIEW_TYPE && nachY === vorY && nachX !== vorX, `beim Übernehmen hatte das Blatt „${aktiv}“ den Fokus · zuletzt bediente Notiz (_smoke-block) ${nachX !== vorX ? "bekam" : "bekam NICHT"} den Block · die andere Notiz blieb ${nachY === vorY ? "unverändert" : "VERÄNDERT"}`);
  });
  await lauf("strg-z-nach-block-uebernehmen", async () => {
    if (fehler !== null || r === null || vorX === null) throw new Vorbedingung(`Vorbereitung fehlgeschlagen: ${fehler}`);
    await cdp.evaluate(`const l = app.workspace.getLeavesOfType("markdown").find((x) => x.view.file && x.view.file.path === "_smoke-block.md"); l.view.editor.undo(); return true;`);
    await sleep(300);
    const nachUndo = await notizText("_smoke-block.md");
    record("strg-z-nach-block-uebernehmen", nachUndo === vorX, `ein Rückgängig-Schritt (editor.undo) ${nachUndo === vorX ? "stellt die Notiz wieder her" : `lässt die Notiz anders: ${q(nachUndo?.slice(0, 200))}`}`);
  });
}

/** Kit 0.80.1: eine Zeile über dem Block, während eine Runde offen ist, kostet die Runde nicht mehr; Übernehmen findet den Block wieder und schreibt dorthin. */
async function punktBlockVerschoben(): Promise<void> {
  await lauf("block-verschoben-uebernehmen-trifft-block", async () => {
    await raeume();
    await stelleFixturenHer();
    const pfad = "_smoke-wanderblock.md";
    const svg = fixtur("unbenannt.svg").trimEnd();
    await oeffneNotiz(pfad, `Kopf\n\n\`\`\`svg-studio\n${svg}\n\`\`\`\n\nEnde\n`, "preview", "tab");
    const knopf = `Array.from(document.querySelectorAll(".markdown-preview-view .svg-studio-block > .svg-studio-edit")).find((b) => b.getBoundingClientRect().width > 0)`;
    await pollUntil(cdp, `return (${knopf}) ? true : null;`, 8000, 250);
    if (!(await klick(`(${knopf})`))) throw new Vorbedingung("Blockknopf nicht klickbar");
    if ((await warteSnap((x) => (x.target ?? "").includes("_smoke-wanderblock"), 8000)) === null) throw new Vorbedingung("Das Panel öffnete nicht auf dem Block");
    if ((await warteSnap((x) => x.notices.some((n) => /no name/i.test(n.text)), 8000)) === null) throw new Vorbedingung("Keine Karte „ohne Namen“ am Block");
    if (!(await klickText(".svg-studio-notice", /Assign names/))) throw new Vorbedingung("Knopf „Assign names“ nicht klickbar");
    const runde = await warteSnap((x) => x.rounds === 1, 8000);
    // Der Nutzer tippt über dem Block eine Zeile, die Runde steht noch offen.
    await cdp.evaluate(`const f = app.vault.getAbstractFileByPath(${q(pfad)}); await app.vault.modify(f, "Neue Zeile oben\\n\\n" + await app.vault.read(f)); return true;`);
    await sleep(600);
    const r = await uebernimm();
    const text = (await liesDatei(pfad)) ?? "";
    const ids = (text.match(/ id="[^"]*"/g) ?? []).length;
    const gut = runde !== null && r.ok && text.startsWith("Neue Zeile oben") && (text.match(/```svg-studio/g) ?? []).length === 1 && ids === 3 && text.includes("Ende");
    record("block-verschoben-uebernehmen-trifft-block", gut, `Runde ${q(runde?.labels)} · Zeile über dem Block eingefügt · Übernehmen ${r.ok ? "ok" : `Fehler ${q(r.snap.status)}`} · Notiz beginnt mit der neuen Zeile: ${text.startsWith("Neue Zeile oben")} · ein Block: ${(text.match(/```svg-studio/g) ?? []).length === 1} · ${ids} ids im Block`);
  });
}

async function punktLesemodus(): Promise<void> {
  await lauf("uebernehmen-lesemodus", async () => {
    await raeume();
    await setzeAcceptAs("block");
    await oeffneNotiz("_smoke-lesen.md", "Vorher\n\nNachher\n", "preview");
    await oeffneNeuesPanel();
    stub.antworten([ANTWORT_ERZEUGEN, ANTWORT_ERZEUGEN]);
    await frage(PROMPT_ERZEUGEN);
    const b = await uebernimm();
    await sleep(300);
    const nachB = (await notizText("_smoke-lesen.md")) ?? "";
    const blockOk = b.ok && nachB.trimEnd().endsWith("```") && nachB.includes("```svg-studio") && /end of the note/.test(b.snap.status ?? "");
    await setzeAcceptAs("file");
    if (!(await klick(`document.querySelector(".svg-studio-new")`))) throw new Vorbedingung("„New“ nicht klickbar");
    await warteSnap((s) => s.rounds === 0);
    await frage("Grundriss zweiter Versuch");
    const vor = await anhaenge();
    const f = await uebernimm();
    await sleep(300);
    const neu = (await anhaenge()).filter((p) => !vor.includes(p));
    const name = neu[0]?.split("/").pop() ?? "";
    const nachF = (await notizText("_smoke-lesen.md")) ?? "";
    const dateiOk = f.ok && neu.length === 1 && nachF.trimEnd().endsWith(`![[${name}]]`) && /end of the note/.test(f.snap.status ?? "");
    record("uebernehmen-lesemodus", blockOk && dateiOk, `Block: ${q(b.snap.status)} (Notiz endet auf dem Zaun: ${nachB.trimEnd().endsWith("```")}) · Datei: ${q(f.snap.status)} (neue Datei ${q(neu)}, Verweis am Ende: ${nachF.trimEnd().endsWith(`![[${name}]]`)}) — Prüfpunkt C4 (b), beide Wege`);
  });
}

async function punktSperre(): Promise<void> {
  await lauf("c4c-sperre-ohne-notiz", async () => {
    await raeume();
    await setzeAcceptAs("block");
    await oeffneNeuesPanel();
    stub.antworten([ANTWORT_ERZEUGEN]);
    await frage(PROMPT_ERZEUGEN);
    const ohne = await warteSnap((s) => s.acceptDisabled === true && /needs an open note/.test(s.hint ?? ""), 3000);
    await oeffneNotiz("_smoke-sperre.md", "Eine Notiz.\n", "source");
    const mit = await warteSnap((s) => s.acceptDisabled === false && (s.hint ?? "") === "", 4000);
    await schliesseNotizen();
    const wieder = await warteSnap((s) => s.acceptDisabled === true && /needs an open note/.test(s.hint ?? ""), 4000);
    record("c4c-sperre-ohne-notiz", ohne !== null && mit !== null && wieder !== null,
      `ohne Notiz gesperrt mit Grund: ${ohne !== null} (${q(ohne?.hint)}) · mit Notiz frei: ${mit !== null} · Notiz zu, wieder gesperrt: ${wieder !== null}`);
  });
}

async function punktAuswahl(): Promise<void> {
  await lauf("c4e-auswahl-dialog", async () => {
    await raeume();
    await setzeAcceptAs("ask");
    await oeffneNeuesPanel();
    stub.antworten([ANTWORT_ERZEUGEN]);
    await frage(PROMPT_ERZEUGEN);
    if (!(await klick(`document.querySelector(".svg-studio-accept")`))) throw new Vorbedingung("Übernehmen nicht klickbar");
    const ohne = await warteDialog(5000);
    if (ohne !== null) {
      await dialogKlick(/cancel|abbrechen/i);
      await sleep(400);
    }
    const abg = await snap();
    await oeffneNotiz("_smoke-wahl.md", "Eine Notiz.\n", "source");
    await setzeCursor("_smoke-wahl.md", 0);
    await klick(`document.querySelector(".svg-studio-accept")`);
    const mit = await warteDialog(5000);
    if (mit !== null) {
      await dialogKlick(/cancel|abbrechen/i);
      await sleep(400);
    }
    const ok = ohne !== null && mit !== null
      && ohne.buttons.length === 2 && ohne.buttons.some((b) => /attachment folder/i.test(b)) && !ohne.buttons.some((b) => /code block/i.test(b)) && ohne.paras.some((p) => /No note is open/.test(p))
      && mit.buttons.some((b) => /attachment folder/i.test(b)) && mit.buttons.some((b) => /code block/i.test(b));
    record("c4e-auswahl-dialog", ok && /Cancelled/.test(abg?.status ?? ""), `ohne Notiz: Knöpfe ${q(ohne?.buttons)}, Text ${q(ohne?.paras)} · mit Notiz: Knöpfe ${q(mit?.buttons)} · Status nach Abbrechen ${q(abg?.status)}`);
  });
}

/** Eine .svg-Datei im Panel öffnen, über den Befehl „Edit SVG“ (aktive Datei). */
async function oeffneDateiImPanel(path: string): Promise<Snap> {
  await cdp.evaluate(`
    const f = app.vault.getAbstractFileByPath(${q(path)});
    const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit) || app.workspace.getLeaf(true);
    await leaf.openFile(f);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return true;
  `);
  await sleep(500);
  await cdp.evaluate(`app.commands.executeCommandById("${PLUGIN_ID}:edit-svg"); return true;`);
  const name = path.split("/").pop() ?? path;
  const s = await warteSnap((x) => (x.target ?? "").includes(name), 8000);
  if (s === null) throw new Vorbedingung(`„Edit SVG“ öffnete das Panel nicht auf ${path}`);
  return s;
}

async function punktBestand(): Promise<void> {
  // Zugleich der Plan-Punkt „editor-angaben-entfernen“ (E4, D3 Schritt 1): derselbe Weg, deshalb nicht umbenannt und nicht doppelt gezählt.
  await lauf("c4f-editor-angaben-entfernen", async () => {
    await raeume();
    await stelleFixturenHer();
    await oeffneDateiImPanel("inkscape.svg");
    const mitKarte = await warteSnap((s) => s.notices.some((n) => /editor data/i.test(n.text)), 8000);
    if (mitKarte === null) throw new Vorbedingung(`Keine Karte „Editor-Angaben“ (Karten: ${q((await snap())?.notices)})`);
    await nimmBilder("bestand").catch((e) => console.log(`    ! Bilder: ${fehlerText(e)}`));
    if (!(await klickText(".svg-studio-notice", /Remove editor data/))) throw new Vorbedingung("Knopf „Remove editor data“ nicht klickbar");
    const runde = await warteSnap((s) => s.rounds === 1, 8000);
    const r = await uebernimm();
    const text = (await liesDatei("inkscape.svg")) ?? "";
    const danach = await warteSnap((s) => s.notices.length === 0, 6000);
    record("c4f-editor-angaben-entfernen",
      runde !== null && r.ok && !/inkscape:|sodipodi:/.test(text) && text.includes('id="mond"') && danach !== null,
      `Karten vorher ${q(mitKarte.notices.map((n) => n.button))} · Runde ${q(runde?.labels)} · Übernehmen ${r.ok ? "ok" : q(r.snap.status)} · Datei ohne inkscape:/sodipodi: ${!/inkscape:|sodipodi:/.test(text)} · danach keine Karte mehr: ${danach !== null}`);
  });
  await lauf("c4f-namen-vergeben", async () => {
    await raeume();
    await stelleFixturenHer();
    await oeffneDateiImPanel("unbenannt.svg");
    const karte = await warteSnap((s) => s.notices.some((n) => /no name/i.test(n.text)), 8000);
    if (karte === null) throw new Vorbedingung(`Keine Karte „ohne Namen“ (Karten: ${q((await snap())?.notices)})`);
    if (!(await klickText(".svg-studio-notice", /Assign names/))) throw new Vorbedingung("Knopf „Assign names“ nicht klickbar");
    const runde = await warteSnap((s) => s.rounds === 1, 8000);
    const r = await uebernimm();
    const text = (await liesDatei("unbenannt.svg")) ?? "";
    const ids = (text.match(/ id="[^"]*"/g) ?? []).length;
    const byteTreu = text.replace(/ id="[^"]*"/g, "") === fixtur("unbenannt.svg");
    record("c4f-namen-vergeben", runde !== null && r.ok && ids === 3 && byteTreu, `Karte ${q(karte.notices.map((n) => n.text))} · Runde ${q(runde?.labels)} · Übernehmen ${r.ok ? "ok" : q(r.snap.status)} · ${ids} ids in der Datei · ohne die neuen ids Byte für Byte der Ausgang: ${byteTreu}`);
  });
  await lauf("c4f-reparieren", async () => {
    await raeume();
    await stelleFixturenHer();
    await oeffneDateiImPanel("kaputt.svg");
    const karte = await warteSnap((s) => s.notices.some((n) => /can't be used/i.test(n.text)), 8000);
    if (karte === null) throw new Vorbedingung(`Keine Karte „unbrauchbar“ (Karten: ${q((await snap())?.notices)})`);
    stub.antworten([ANTWORT_REPARATUR]);
    if (!(await klickText(".svg-studio-notice", /^Repair$/))) throw new Vorbedingung("Knopf „Repair“ nicht klickbar");
    const runde = await warteSnap((s) => s.rounds === 1, 20000);
    const chats = chatAnfragen();
    const frageText = chats[0] ? nachrichten(chats[0]).at(-1)?.content ?? "" : "";
    const r = await uebernimm();
    const text = (await liesDatei("kaputt.svg")) ?? "";
    const wohlgeformt = await cdp.evaluate<boolean>(`return !new DOMParser().parseFromString(${q(text)}, "image/svg+xml").querySelector("parsererror");`);
    record("c4f-reparieren",
      runde !== null && r.ok && wohlgeformt && text.includes('id="punkt"') && frageText.includes("nicht wohlgeformt") && frageText.includes('id="kasten"'),
      `Karte ${q(karte.notices.map((n) => n.text))} · Runde ${q(runde?.labels)} · Anfrage an den Stub nennt das Parserproblem: ${frageText.includes("nicht wohlgeformt")} und enthält den kaputten Text: ${frageText.includes('id="kasten"')} · Übernehmen ${r.ok ? "ok" : q(r.snap.status)} · Datei danach wohlgeformt: ${wohlgeformt}`);
  });
}

async function punktNichtzeichen(): Promise<void> {
  await lauf("c4g-nichtzeichen-im-attribut", async () => {
    await raeume();
    const svg = (z: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="a" data-x="a${z}b" x="1" y="1" width="8" height="8"/></svg>`;
    const FFFE = String.fromCharCode(0xfffe);
    const FFFF = String.fromCharCode(0xffff);
    const body = `Zwei Blöcke mit Nichtzeichen im Attribut.\n\n\`\`\`svg-studio\n${svg(FFFE)}\n\`\`\`\n\n\`\`\`svg-studio\n${svg(FFFF)}\n\`\`\`\n`;
    await oeffneNotiz("_smoke-nichtzeichen.md", body, "preview");
    const r = await pollUntil<{ fehler: number; bilder: number }>(cdp, `
      ${SICHTBAR}
      const fehler = Array.from(document.querySelectorAll(".markdown-preview-view .svg-studio-error")).filter(vis).length;
      const bilder = Array.from(document.querySelectorAll(".markdown-preview-view img.svg-studio-img")).filter(vis).length;
      return fehler + bilder >= 2 ? { fehler, bilder } : null;
    `, 8000, 250);
    const parser = await cdp.evaluate<boolean[]>(`return [${q(svg(FFFE))}, ${q(svg(FFFF))}].map((t) => !!new DOMParser().parseFromString(t, "image/svg+xml").querySelector("parsererror"));`);
    record("c4g-nichtzeichen-im-attribut", r !== null && r.fehler === 2 && r.bilder === 0 && parser.every(Boolean),
      `Blöcke mit U+FFFE und U+FFFF: ${r?.fehler ?? "?"} Fehlerkästen, ${r?.bilder ?? "?"} Bilder · der Parser des Fensters lehnt beide ab: ${q(parser)}`);
  });
}

async function punktSchliessen(): Promise<void> {
  await lauf("schliessen-mit-offener-runde", async () => {
    await raeume();
    await oeffneNeuesPanel();
    stub.antworten([ANTWORT_ERZEUGEN]);
    await frage(PROMPT_ERZEUGEN);
    await cdp.evaluate(`for (const l of app.workspace.getLeavesOfType(${q(VIEW_TYPE)})) l.detach(); return true;`);
    const d1 = await warteDialog(5000);
    const gesehen = d1 !== null && d1.paras.some((p) => /unapplied round/.test(p)) && d1.buttons.some((b) => /keep/i.test(b)) && d1.buttons.some((b) => /discard/i.test(b));
    if (d1 !== null) await dialogKlick(/keep/i);
    await sleep(500);
    const offen = await cdp.evaluate<number>(`return app.workspace.getLeavesOfType(${q(VIEW_TYPE)}).length;`);
    await oeffneNeuesPanel();
    const behalten = await warteSnap((s) => s.rounds === 1, 5000);
    await cdp.evaluate(`for (const l of app.workspace.getLeavesOfType(${q(VIEW_TYPE)})) l.detach(); return true;`);
    const d2 = await warteDialog(5000);
    if (d2 !== null) await dialogKlick(/discard/i);
    await sleep(500);
    await oeffneNeuesPanel();
    const verworfen = await warteSnap((s) => s.rounds === 0, 3000);
    record("schliessen-mit-offener-runde", gesehen && offen === 0 && behalten !== null && d2 !== null && verworfen !== null,
      `Blatt zu mit Runde: Dialog ${q(d1?.paras)} Knöpfe ${q(d1?.buttons)} · Behalten: Blatt weg (${offen} offen), neues Panel hat ${behalten?.rounds ?? "keine"} Runde wieder · erneut zu, Verwerfen: Dialog ${d2 !== null}, neues Panel mit ${verworfen?.rounds ?? "?"} Runden`);
  });
}

const VERZOEGERE = (ms: number): string => `const orig = app.vault.create.bind(app.vault); app.vault.create = async (...a) => { await new Promise((r) => setTimeout(r, ${ms})); return orig(...a); }; return true;`;

async function punktRandfaelle(): Promise<void> {
  await lauf("rest10a-behalten-waehrend-uebernehmen", async () => {
    await raeume();
    await oeffneNotiz("_smoke-rand.md", "Vorher\n\nNachher\n", "source");
    await setzeCursor("_smoke-rand.md", 2);
    await oeffneNeuesPanel();
    stub.antworten([ANTWORT_ERZEUGEN]);
    await frage(PROMPT_ERZEUGEN);
    await cdp.evaluate(VERZOEGERE(2500));
    let dialogGekommen = false;
    try {
      await klick(`document.querySelector(".svg-studio-accept")`);
      await sleep(500);
      await cdp.evaluate(`for (const l of app.workspace.getLeavesOfType(${q(VIEW_TYPE)})) l.detach(); return true;`);
      // Zulässig sind zwei Ausgänge: der Dialog kommt (alte Runden noch da) und „Behalten“ wird gewählt, oder Schließen wartet das Schreiben ab und fragt nicht mehr
      // (Runden dann leer). Falsch ist nur die zweite Datei danach.
      const d = await warteDialog(4000);
      dialogGekommen = d !== null;
      if (d !== null) await dialogKlick(/keep/i);
      await sleep(3500);
    } finally {
      await cdp.evaluate(`delete app.vault.create; return true;`);
    }
    const erste = await anhaenge();
    await oeffneNeuesPanel();
    const s = await warteSnap((x) => x.target !== null, 4000);
    const rundenDa = (s?.rounds ?? 0) > 0;
    if (rundenDa) {
      await uebernimm().catch(() => undefined);
      await sleep(1000);
    }
    const zweite = await anhaenge();
    record("rest10a-behalten-waehrend-uebernehmen", erste.length === 1 && zweite.length === 1,
      `nach dem ersten Übernehmen (während des Schreibens „Behalten“): ${erste.length} Datei ${q(erste)} · Schließen-Dialog ${dialogGekommen ? "kam (Keep gewählt)" : "kam nicht (Schließen wartete das Schreiben ab)"} · neues Panel zeigt ${s?.rounds ?? "?"} Runde(n) · nach erneutem Übernehmen ${zweite.length} Dateien ${q(zweite)} (erwartet: genau eine)`);
  });
  await lauf("rest10b-angebotenes-ziel-waehrend-uebernehmen", async () => {
    await raeume();
    await stelleFixturenHer();
    await oeffneNotiz("_smoke-rand2.md", "Vorher\n\nNachher\n", "source");
    await oeffneNotiz("Einbettung.md", fixtur("Einbettung.md"), "preview", "split").catch(() => undefined);
    await sleep(500);
    await cdp.evaluate(`
      const alle = []; app.workspace.iterateRootLeaves((l) => alle.push(l));
      const l = alle.find((x) => x.view.file && x.view.file.path === "_smoke-rand2.md");
      if (l) { app.workspace.setActiveLeaf(l, { focus: true }); l.view.editor.setCursor({ line: 2, ch: 0 }); }
      return true;
    `);
    await oeffneNeuesPanel();
    stub.antworten([ANTWORT_ERZEUGEN]);
    await frage(PROMPT_ERZEUGEN);
    const knopf = `Array.from(document.querySelectorAll(".markdown-preview-view .internal-embed.image-embed [data-svg-studio-button]")).find((b) => b.getBoundingClientRect().width > 0)`;
    await pollUntil(cdp, `return (${knopf}) ? true : null;`, 8000, 250);
    await cdp.evaluate(VERZOEGERE(3000));
    let nach: Snap | null = null;
    try {
      await klick(`document.querySelector(".svg-studio-accept")`);
      await sleep(500);
      if (!(await klick(`(${knopf})`))) throw new Vorbedingung("Einbettungsknopf nicht klickbar");
      await sleep(500);
      nach = await warteSnap((x) => x.rounds === 0, 12000);
    } finally {
      await cdp.evaluate(`delete app.vault.create; return true;`);
    }
    const s = await snap();
    record("rest10b-angebotenes-ziel-waehrend-uebernehmen", nach !== null && (s?.target ?? "").includes("probe.svg"),
      `während des Schreibens auf „In SVG Studio bearbeiten“ an probe.svg geklickt; nach dem Übernehmen steht im Panel: ${q(s?.target)} (erwartet: probe.svg, nicht die eben angelegte Datei)`);
  });
}

/** Ein Lauf mit drei Änderungen auf `probe.svg` über den Stub; liefert den Zustand mit den drei Karten. */
async function dreiKarten(): Promise<Snap> {
  await raeume();
  await stelleFixturenHer();
  await oeffneProbeImPanel();
  stub.antworten([ANTWORT_MEHRERE]);
  const s = await frage(PROMPT_MEHRERE);
  if (s.cards.length !== 3) throw new Vorbedingung(`Erwartet drei Karten, das Panel zeigt ${s.cards.length}: ${q(s.cards.map((c) => c.text))}`);
  return s;
}

async function punktPruefliste(): Promise<void> {
  const ORIG = fixtur("probe.svg");
  // Ablehnen (und die Beschriftung der Karten, aus demselben Lauf).
  let fehler: string | null = null;
  let karten: Snap["cards"] = [];
  let nachAblehnen: Snap | null = null;
  let tuerVorschau: string | null = null;
  let uebernommen: { ok: boolean; snap: Snap } | null = null;
  let datei: string | null = null;
  if (gewaehlt("pruefliste-kartenbeschriftung", "pruefliste-ablehnen")) {
    try {
      const s = await dreiKarten();
      karten = s.cards;
      if (!(await klick(kartenKnopf(/tuer/, ".okit-review-reject")))) throw new Vorbedingung("Ablehnen-Knopf der Tür-Karte nicht klickbar");
      nachAblehnen = await warteSnap((x) => x.cards.some((c) => /tuer/.test(c.text) && c.cls.includes("is-rejected")), 5000);
      tuerVorschau = await vorschauAttr("tuer", "x");
      uebernommen = await uebernimm();
      datei = await liesDatei("probe.svg");
    } catch (e) {
      fehler = fehlerText(e);
    }
  }
  await lauf("pruefliste-kartenbeschriftung", async () => {
    if (fehler !== null && karten.length === 0) throw new Vorbedingung(`Vorbereitung fehlgeschlagen: ${fehler}`);
    const texte = karten.map((c) => `${c.text} [alt ${c.del} → neu ${c.ins}]`);
    const karte = (re: RegExp): Snap["cards"][number] | undefined => karten.find((c) => re.test(c.text));
    const tuerK = karte(/tuer/);
    const nordK = karte(/wand-nord/);
    const suedK = karte(/wand-sued/);
    // Jede Karte nennt Element und Eigenschaft und zeigt den Wert alt → neu als gestrichenen und eingefügten Teil (Redline); Autor, Runde und Art stehen in der Kopfzeile.
    record("pruefliste-kartenbeschriftung",
      karten.length === 3 && /x/.test(tuerK?.text ?? "") && tuerK?.del === "165" && tuerK?.ins === "145" && /stroke-width/.test(nordK?.text ?? "") && nordK?.del === "2" && nordK?.ins === "6" && /stroke/.test(suedK?.text ?? "") && /8b0000/.test(suedK?.ins ?? "") && karten.every((c) => /^Model · Round 1/.test(c.text)),
      `im sichtbaren Panel: ${q(texte)}`);
  });
  await lauf("pruefliste-ablehnen", async () => {
    if (fehler !== null) throw new Vorbedingung(`Vorbereitung fehlgeschlagen: ${fehler}`);
    if (uebernommen === null || datei === null) throw new Vorbedingung("Kein Ergebnis des Übernehmens");
    // Erwartet: Nord- und Südwand geändert, die abgelehnte Tür bleibt wie im Ausgang. Bytes: der Ausgang mit genau diesen zwei Ersetzungen.
    const erwartet = mit(ORIG, NORD, SUED);
    record("pruefliste-ablehnen", uebernommen.ok && nachAblehnen !== null && tuerVorschau === "165" && datei === erwartet && datei.includes(`x="165"`) && !datei.includes(`x="145"`),
      `Karte der Tür abgelehnt: ${nachAblehnen !== null} · Vorschau danach Tür x=${q(tuerVorschau)} · Übernehmen ${uebernommen.ok ? "ok" : q(uebernommen.snap.status)} · Datei = Ausgang mit nur Nord- und Südwand geändert, byte-gleich: ${datei === erwartet} (Tür x=165 steht noch: ${datei.includes(`x="165"`)})`);
  });

  // Annehmen (die Gegenprobe zu Ablehnen: ohne Ablehnen steht die Änderung drin) und die Bilder der Prüfliste.
  await lauf("pruefliste-annehmen", async () => {
    const s = await dreiKarten();
    await nimmBilder("pruefliste").catch((e) => console.log(`    ! Bilder: ${fehlerText(e)}`));
    if (!(await klick(`document.querySelector(".svg-studio-changes .okit-review-accept-all")`))) throw new Vorbedingung("„Accept all“ nicht klickbar");
    const alle = await warteSnap((x) => x.cards.length === 3 && x.cards.every((c) => c.cls.includes("is-accepted")), 5000);
    const tuer = await vorschauAttr("tuer", "x");
    const r = await uebernimm();
    const datei2 = await liesDatei("probe.svg");
    const erwartet = mit(ORIG, TUER, NORD, SUED);
    record("pruefliste-annehmen", alle !== null && tuer === "145" && r.ok && datei2 === erwartet,
      `drei Karten (${s.cards.length}) alle angenommen: ${alle !== null} · Vorschau Tür x=${q(tuer)} · Übernehmen ${r.ok ? "ok" : q(r.snap.status)} · Datei = Ausgang mit allen drei Änderungen, byte-gleich: ${datei2 === erwartet}`);
  });

  // Kommentar.
  await lauf("pruefliste-kommentar", async () => {
    await dreiKarten();
    stub.antworten([ANTWORT_MEHRERE, ANTWORT_OSTWAND]);
    if (!(await klick(kartenKnopf(/tuer/, ".okit-review-comment")))) throw new Vorbedingung("Kommentar-Taste der Tür-Karte nicht klickbar");
    const feld = await pollUntil<{ tag: string; titel: string }>(cdp, `const f = document.querySelector(".modal-container .okit-prompt-field"); if (!f) return null; const m = f.closest(".modal"); return { tag: f.tagName, titel: ((m.querySelector(".modal-title") || {}).textContent || "").trim() };`, 5000, 150);
    if (feld === null) throw new Vorbedingung("Der Kommentar-Dialog (promptText) kam nicht");
    await cdp.evaluate(`const f = document.querySelector(".modal-container .okit-prompt-field"); f.focus(); return true;`);
    await cdp.send("Input.insertText", { text: KOMMENTAR });
    if (!(await dialogKlick(/^OK$/))) throw new Vorbedingung("OK im Kommentar-Dialog nicht klickbar");
    const karte = await warteSnap((x) => x.cards.some((c) => /tuer/.test(c.text) && c.comment.includes(KOMMENTAR)), 5000);
    // Die nächste Verfeinern-Anfrage trägt die Rückmeldung. Stub-Antworten: die Antwort der ersten Runde ist verbraucht, es folgt die zweite.
    stub.loescheMitschnitt();
    stub.antworten([ANTWORT_OSTWAND]);
    await frage("Mach die Ostwand dicker.");
    const anfrage = chatAnfragen().at(-1);
    const letzte = anfrage ? nachrichten(anfrage).at(-1)?.content ?? "" : "";
    const tuerCard = karte?.cards.find((c) => /tuer/.test(c.text));
    record("pruefliste-kommentar",
      feld.tag === "TEXTAREA" && karte !== null && (tuerCard?.cls ?? "").includes("is-accepted") && letzte.includes("Rückmeldung zur letzten Runde") && letzte.includes(KOMMENTAR),
      `Dialog ${q(feld.titel)} als ${feld.tag} (mehrzeilig) · Karte zeigt den Kommentar: ${karte !== null} (Zustand bleibt ${q(tuerCard?.cls)}) · Anfrage ${chatAnfragen().length} an den Stub endet auf ${q(letzte.slice(-260))}`);
  });
}

async function punktFelder(): Promise<void> {
  await lauf("bestand-ohne-runde-vorschau", async () => {
    await raeume();
    await stelleFixturenHer();
    await oeffneProbeImPanel();
    const s = await warteSnap((x) => !x.previewHidden && x.svgIds !== null && (x.measure ?? "") !== "", 8000);
    if (s === null) throw new Vorbedingung(`Keine Vorschau am Bestand (Zustand ${q(await snap())})`);
    record("bestand-ohne-runde-vorschau",
      s.rounds === 0 && (s.caption ?? "") === "Current state" && (s.svgIds ?? []).includes("tuer") && (s.fieldsHint ?? "") !== "" && s.acceptDisabled === true,
      `ohne Lauf: Beschriftung ${q(s.caption)} · ${s.svgIds?.length} Elemente mit id · Maßzeile ${q(s.measure)} · Felder-Hinweis ${q(s.fieldsHint)} · Übernehmen gesperrt: ${s.acceptDisabled}`);
    // Und die Felder kommen nach einem Klick (Element mit Feldern: die Tür).
    const f = await klickImBild("tuer");
    console.log(`    Felder der Tür: ${q(f.fields.map((x) => `${x.name}=${x.value}`))}`);
  });

  await lauf("zahlenfeld-genau-ein-attribut", async () => {
    await raeume();
    await stelleFixturenHer();
    await oeffneDateiImPanel("felder.svg");
    if ((await warteSnap((x) => !x.previewHidden && x.svgIds !== null, 8000)) === null) throw new Vorbedingung("Keine Vorschau am Bestand felder.svg");
    const f = await klickImBild("mond");
    await nimmBilder("felder").catch((e) => console.log(`    ! Bilder: ${fehlerText(e)}`));
    const r0 = f.fields.find((x) => x.name === "r");
    await setzeFeld("r", "60");
    const runde = await warteSnap((x) => x.rounds === 1, 5000);
    const r = await uebernimm();
    const nach = await liesDatei("felder.svg");
    const erwartet = ersetze(fixtur("felder.svg"), `r="40"`, `r="60"`);
    record("zahlenfeld-genau-ein-attribut", runde !== null && r.ok && nach === erwartet && r0?.value === "40",
      `Feld r stand auf ${q(r0?.value)} · Runde ${q(runde?.labels)} · Übernehmen ${r.ok ? "ok" : q(r.snap.status)} · Quelltext nachher = Quelltext vorher mit genau r="40" → r="60", sonst byte-gleich: ${nach === erwartet}`);
  });

  await lauf("handrunde-in-versionsliste", async () => {
    await raeume();
    await stelleFixturenHer();
    await oeffneDateiImPanel("felder.svg");
    // Ein Lauf vorweg: die Kit-Versionsliste zeigt erst ab zwei Runden Zeilen.
    stub.antworten([mit(fixtur("felder.svg"), FELDER_FILL)]);
    await frage("Färbe den Mond wärmer.");
    await klickImBild("mond");
    await setzeFeld("r", "60");
    await warteSnap((x) => x.rounds === 2, 5000);
    await klickImBild("mond");
    await setzeFeld("cx", "110");
    const s = await warteSnap((x) => x.rounds === 2 && /cx/.test(x.labels[1] ?? "") && x.listRows === 2, 5000);
    const z = await snap();
    const hand = (z?.metas ?? []).filter((m) => m.startsWith("hand"));
    record("handrunde-in-versionsliste", s !== null && hand.length === 1 && (z?.labels[1] ?? "").startsWith("By hand:") && (z?.labels[1] ?? "").includes("r") && z?.rounds === 2,
      `nach einem Lauf und zwei Feldänderungen: ${z?.rounds} Runden, davon ${hand.length} von Hand · Zeilen der Versionsliste: ${z?.listRows} · Beschriftung der Handrunde ${q(z?.labels[1])} · Runden ${q(z?.metas)}`);
  });

  await lauf("drehmitte-in-gruppe", async () => {
    await raeume();
    await stelleFixturenHer();
    await oeffneDateiImPanel("drehung.svg");
    if ((await warteSnap((x) => !x.previewHidden && x.svgIds !== null, 8000)) === null) throw new Vorbedingung("Keine Vorschau am Bestand drehung.svg");
    await klickImBild("kasten");
    // Die Lage im Panel kann sich nach der ersten Runde verschieben (Karten, Beschriftung): gemessen wird relativ zur Wurzel des Bildes, als Bruchteil ihrer Breite.
    const mitte = (): Promise<{ fx: number; fy: number; breite: number; cx: number; cy: number; transform: string | null }> => cdp.evaluate(`
      const e = ${IM_BILD("kasten")};
      const svg = e.ownerSVGElement;
      const w = svg.getBoundingClientRect();
      const r = e.getBoundingClientRect();
      const b = e.getBBox();
      return { fx: (r.left + r.width / 2 - w.left) / w.width, fy: (r.top + r.height / 2 - w.top) / w.width, breite: w.width, cx: b.x + b.width / 2, cy: b.y + b.height / 2, transform: e.getAttribute("transform") };
    `);
    const vorher = await mitte();
    await setzeFeld("rotate", "30");
    const runde = await warteSnap((x) => x.rounds === 1, 5000);
    const nachher = await mitte();
    const m = /rotate\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(nachher.transform ?? "");
    const a = m ? Number(m[1]) : NaN;
    const cx = m ? Number(m[2]) : NaN;
    const cy = m ? Number(m[3]) : NaN;
    const lokal = Math.abs(cx - vorher.cx) < 0.01 && Math.abs(cy - vorher.cy) < 0.01;
    // Wirkung am Bild: eine Drehung um die eigene Mitte lässt die Mitte des Elements auf dem Bildschirm, wo sie war.
    const bildschirm = Math.hypot(nachher.fx - vorher.fx, nachher.fy - vorher.fy) * nachher.breite;
    // Gegenprobe: dieselbe Drehung um eine falsche Mitte (den Ursprung) verschiebt das Element deutlich, die Messung kann also anschlagen.
    const falsch = await cdp.evaluate<number>(`
      const e = ${IM_BILD("kasten")};
      const svg = e.ownerSVGElement;
      const alt = e.getAttribute("transform");
      const mitteVon = () => { const w = svg.getBoundingClientRect(); const r = e.getBoundingClientRect(); return [(r.left + r.width / 2 - w.left), (r.top + r.height / 2 - w.top)]; };
      const a = mitteVon();
      e.setAttribute("transform", "translate(15 5) rotate(30 0 0)");
      const b = mitteVon();
      e.setAttribute("transform", alt);
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    `);
    if (falsch < 5) throw new Vorbedingung(`Gegenprobe ohne Biss: eine Drehung um die falsche Mitte verschob das Element nur um ${falsch.toFixed(2)} px`);
    record("drehmitte-in-gruppe", runde !== null && a === 30 && lokal && bildschirm < 1,
      `Element mit eigenem translate in einer Gruppe mit translate und scale(2): transform vorher ${q(vorher.transform)}, nachher ${q(nachher.transform)} · Drehmitte (${cx}, ${cy}) gegen die Mitte der lokalen getBBox() (${vorher.cx}, ${vorher.cy}): ${lokal} · Mitte auf dem Bildschirm verschoben um ${bildschirm.toFixed(2)} px (erwartet unter 1; Gegenprobe: Drehung um den Ursprung verschiebt um ${falsch.toFixed(1)} px)`);
  });
}

async function punktMobil(): Promise<void> {
  const haenge = async (): Promise<Cdp> => {
    const c = await attachTo("workspace", port, REPO_NAME);
    if (c === null) throw new Error("Kein Hauptfenster nach dem Neuladen in der Mobil-Emulation");
    cdp = c;
    const v = await bereiteVor(c);
    console.log(`  (Mobil: ${v.hinweis}; ${v.neu})`);
    return c;
  };
  let mobil = false;
  const einschalten = async (): Promise<void> => {
    if (mobil) return;
    cdp = await mobilEin(cdp, haenge);
    mobil = true;
    await sleep(800);
  };
  try {
    // Die Felder am Bestand zuerst (ein Element in der Vorschau antippen), dann der Lauf mit Prüfliste.
    await lauf("mobil-felder", async () => {
      await einschalten();
      await raeume();
      await stelleFixturenHer();
      await oeffneDateiImPanel("felder.svg");
      if ((await warteSnap((x) => !x.previewHidden && x.svgIds !== null, 8000)) === null) throw new Vorbedingung("Keine Vorschau am Bestand felder.svg in der Mobil-Emulation");
      const f = await klickImBild("mond");
      await sleep(400);
      await nimmBilder("mobil-felder").catch((e) => console.log(`    ! Bilder: ${fehlerText(e)}`));
      const m = await cdp.evaluate<{ docUeber: boolean; panelUeber: boolean; ausserhalb: string[]; hoehen: number[]; breiten: number[] }>(`
        const p = document.querySelector(".svg-studio-panel");
        const eingaben = Array.from(document.querySelectorAll(".svg-studio-fields .svg-studio-field-input"));
        const aus = [];
        for (const i of eingaben) { const r = i.getBoundingClientRect(); if (r.left < -0.5 || r.right > window.innerWidth + 0.5) aus.push(i.getAttribute("data-field") + " " + Math.round(r.left) + ".." + Math.round(r.right)); }
        return { docUeber: document.documentElement.scrollWidth > window.innerWidth + 1, panelUeber: p ? p.scrollWidth > p.clientWidth + 1 : true, ausserhalb: aus,
          hoehen: eingaben.map((i) => Math.round(i.getBoundingClientRect().height)), breiten: eingaben.map((i) => Math.round(i.getBoundingClientRect().width)) };
      `);
      const zahlen = f.fields.filter((x) => !x.readOnly && ["cx", "cy", "r", "stroke-width"].includes(x.name));
      record("mobil-felder", f.fields.length >= 4 && zahlen.length >= 3 && zahlen.every((x) => x.inputmode === "decimal") && !m.docUeber && !m.panelUeber && m.ausserhalb.length === 0,
        `${f.fields.length} Felder (${q(f.fields.map((x) => x.name))}), Zahlenfelder mit inputmode decimal: ${zahlen.every((x) => x.inputmode === "decimal")} · Seitenüberlauf Dokument ${m.docUeber}, Panel ${m.panelUeber} · außerhalb: ${q(m.ausserhalb)} · Höhen ${q(m.hoehen)} px, Breiten ${q(m.breiten)} px (Emulation, ohne Bildschirmtastatur)`);
    });
    // Geometrie, nicht Gerät: Obsidian setzt --keyboard-height bei offener Tastatur; die Emulation hat keine Bildschirmtastatur, der Punkt setzt die Variable von Hand
    // (iPhone-Messung 2026-11-05: Tastatur 272 px hoch, „Übernehmen“ lag darunter). Gegenprobe: ohne Variable bleibt der Abstand klein.
    await lauf("mobil-tastaturabstand", async () => {
      await einschalten();
      await raeume();
      await stelleFixturenHer();
      await oeffneDateiImPanel("felder.svg");
      if ((await warteSnap((x) => !x.previewHidden && x.svgIds !== null, 8000)) === null) throw new Vorbedingung("Keine Vorschau am Bestand felder.svg in der Mobil-Emulation");
      const m = await cdp.evaluate<{ ohne: number; mit: number; tastatur: number; knopf: boolean; unterKante: number | null; kante: number }>(`
        const p = document.querySelector(".svg-studio-panel");
        const pad = () => parseFloat(getComputedStyle(p).paddingBottom);
        document.body.style.removeProperty("--keyboard-height");
        const ohne = pad();
        const tastatur = 272;
        document.body.style.setProperty("--keyboard-height", tastatur + "px");
        const mit = pad();
        // Wie weit lässt sich das Panel scrollen, und wo endet „Übernehmen“ dann? Der scrollende Vorfahr ist je nach Obsidian-Version das Panel oder sein Blatt.
        let s = p; while (s && s.scrollHeight <= s.clientHeight + 1 && s.parentElement) s = s.parentElement;
        if (s) s.scrollTop = s.scrollHeight;
        const k = document.querySelector(".svg-studio-accept");
        const r = k ? k.getBoundingClientRect() : null;
        const out = { ohne, mit, tastatur, knopf: k !== null, unterKante: r ? Math.round(r.bottom) : null, kante: window.innerHeight - tastatur };
        document.body.style.removeProperty("--keyboard-height");
        return out;
      `);
      record("mobil-tastaturabstand", m.ohne < 100 && m.mit >= m.tastatur && m.knopf && m.unterKante !== null && m.unterKante <= m.kante,
        `Abstand unten im Panel ohne Tastatur ${m.ohne} px, mit --keyboard-height ${m.tastatur} px: ${m.mit} px · „Übernehmen“ endet bei y ${m.unterKante} nach dem Scrollen, Tastaturoberkante ${m.kante} (Geometrie-Simulation, am Gerät zu messen)`);
    });
    await lauf("mobil-emulation", async () => {
      await einschalten();
      await raeume();
      await stelleFixturenHer();
      if (!(await openExisting(cdp, "Einbettung.md", "preview"))) throw new Vorbedingung("Einbettung.md rendert in der Mobil-Emulation nicht");
      const knopf = `Array.from(document.querySelectorAll(".markdown-preview-view .internal-embed.image-embed [data-svg-studio-button]")).find((b) => b.getBoundingClientRect().width > 0)`;
      await pollUntil(cdp, `return (${knopf}) ? true : null;`, 8000, 250);
      const groesse = await cdp.evaluate<{ w: number; h: number }>(`const r = (${knopf}).getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };`);
      (globalThis as { __knopf?: { w: number; h: number } }).__knopf = groesse;
      if (!(await klick(`(${knopf})`))) throw new Vorbedingung("Einbettungsknopf in der Mobil-Emulation nicht klickbar");
      if ((await warteSnap((s) => (s.target ?? "").includes("probe.svg"), 8000)) === null) throw new Vorbedingung("Panel öffnete in der Mobil-Emulation nicht");
      stub.antworten([ANTWORT_VERFEINERN]);
      const s = await frage(PROMPT_VERFEINERN);
      await sleep(500);
      await nimmBilder("mobil").catch((e) => console.log(`    ! Bilder: ${fehlerText(e)}`));
      (globalThis as { __review?: unknown }).__review = await cdp.evaluate(`
        const sel = { annehmen: ".okit-review-accept", ablehnen: ".okit-review-reject", kommentar: ".okit-review-comment", alleAnnehmen: ".okit-review-accept-all", alleAblehnen: ".okit-review-reject-all" };
        const out = {};
        for (const [k, v] of Object.entries(sel)) { const e = document.querySelector(".svg-studio-changes " + v); const r = e ? e.getBoundingClientRect() : null; out[k] = r ? { w: Math.round(r.width), h: Math.round(r.height) } : null; }
        return out;
      `);
      const m = await cdp.evaluate<{ mobil: boolean; breite: number; hoehe: number; docUeber: boolean; panelUeber: boolean; ausserhalb: string[]; stage: { w: number; h: number } | null; messzeile: string }>(`
        const p = document.querySelector(".svg-studio-panel");
        const aus = [];
        for (const sel of [".svg-studio-send", ".svg-studio-accept", ".svg-studio-discard", ".svg-studio-new", ".svg-studio-input"]) {
          const e = document.querySelector(sel);
          if (!e) { aus.push(sel + " fehlt"); continue; }
          const r = e.getBoundingClientRect();
          if (r.left < -0.5 || r.right > window.innerWidth + 0.5) aus.push(sel + " " + Math.round(r.left) + ".." + Math.round(r.right));
        }
        const st = document.querySelector(".svg-studio-stage");
        const sr = st ? st.getBoundingClientRect() : null;
        return { mobil: document.body.classList.contains("is-mobile"), breite: window.innerWidth, hoehe: window.innerHeight,
          docUeber: document.documentElement.scrollWidth > window.innerWidth + 1, panelUeber: p ? p.scrollWidth > p.clientWidth + 1 : true,
          ausserhalb: aus, stage: sr ? { w: Math.round(sr.width), h: Math.round(sr.height) } : null, messzeile: (document.querySelector(".svg-studio-measure") || {}).textContent || "" };
      `);
      record("mobil-emulation", m.mobil && m.breite === BREITE && !m.docUeber && !m.panelUeber && m.ausserhalb.length === 0 && m.stage !== null && m.stage.w > 0 && m.stage.h > 0 && m.messzeile !== "" && s.rounds === 1,
        `Emulation ${m.breite} × ${m.hoehe} (is-mobile ${m.mobil}) · Seitenüberlauf Dokument ${m.docUeber}, Panel ${m.panelUeber} · Knöpfe außerhalb: ${q(m.ausserhalb)} · Vorschau ${q(m.stage)} · Maßzeile ${q(m.messzeile)}`);
    });
    await lauf("mobil-pruefliste-trefflaeche-44px", async () => {
      const g = (globalThis as { __review?: Record<string, { w: number; h: number } | null> }).__review;
      if (g === undefined) throw new Vorbedingung("Die Knöpfe der Prüfliste wurden in der Mobil-Emulation nicht vermessen");
      const eintraege = Object.entries(g);
      const fehlt = eintraege.filter(([, v]) => v === null).map(([k]) => k);
      const zuKlein = eintraege.filter(([, v]) => v !== null && (v.w < 44 || v.h < 44)).map(([k, v]) => `${k} ${v!.w} × ${v!.h}`);
      if (fehlt.length > 0) throw new Vorbedingung(`Knöpfe nicht im DOM: ${fehlt.join(", ")}`);
      record("mobil-pruefliste-trefflaeche-44px", zuKlein.length === 0, `Knöpfe der Prüfliste in der Emulation: ${eintraege.map(([k, v]) => `${k} ${v!.w} × ${v!.h}`).join(" · ")} (verlangt mindestens 44 × 44; zu klein: ${q(zuKlein)})`);
    });
    await lauf("mobil-trefflaeche-44px", async () => {
      const g = (globalThis as { __knopf?: { w: number; h: number } }).__knopf;
      if (g === undefined) throw new Vorbedingung("Der Einbettungsknopf wurde in der Mobil-Emulation nicht vermessen");
      record("mobil-trefflaeche-44px", g.w >= 44 && g.h >= 44, `Einbettungsknopf ${g.w} × ${g.h} px (Emulation, Plan-Messpunkt M2: mindestens 44 × 44)`);
    });
  } finally {
    await entferneFakeManager(cdp, { pluginId: MANAGER_ID, invalidiere: [PLUGIN_ID] }).catch(() => undefined);
    await mobilAus(cdp).catch(() => undefined);
  }
  void HOEHE;
}

// ── Hauptlauf ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("setup")) {
    setup();
    return;
  }
  const portArg = args.value("port");
  if (!portArg || !Number.isInteger(Number(portArg))) throw new Error("--port <Port> ist Pflicht (Zweitinstanz, z. B. --port 9660) — kein Standardport.");
  port = Number(portArg);
  bilderDir = args.value("bilder") ?? null;
  const nurArg = args.value("nur");
  if (nurArg !== undefined) {
    nur = new Set(nurArg.split(",").map((x) => x.trim()));
    for (const n of nur) if (!(PUNKTE as readonly string[]).includes(n)) throw new Error(`--nur: unbekannter Prüfpunkt ${n}`);
  }

  console.log(`GUI-Smoke svg-studio — Obsidian auf Port ${port}`);
  const verbunden = await attachTo("workspace", port, REPO_NAME);
  if (verbunden === null) throw new Error(`Kein Obsidian-Hauptfenster auf Port ${port} für Vault „${REPO_NAME}“. Läuft die Zweitinstanz (Rezept im Dateikopf)?`);
  cdp = verbunden;
  await cdp.mitschnitt((z) => { konsole.push(z.slice(0, 400)); });
  stub = await startLlmStub({ models: ["stub-modell"] });
  console.log(`LLM-Stub: ${stub.url}`);

  let neuGestartet = false;
  let farbklasse = "";
  let themaWar: string | null = null;
  const zustandZurueck = async (): Promise<void> => {
    try {
      await cdp.evaluate(`delete app.vault.create; return true;`);
      if (farbklasse !== "") await cdp.evaluate(`document.body.className = ${q(farbklasse)}; return true;`);
      void themaWar;
      await setzeAcceptAs("file");
      await entferneFakeManager(cdp, { pluginId: MANAGER_ID, invalidiere: [PLUGIN_ID] });
    } catch { console.log("  ! Aufräumen im Renderer fehlgeschlagen — Staging-Vault von Hand prüfen"); }
    await stub.stop().catch(() => undefined);
  };
  const zustand = beimAbbruch(zustandZurueck, "Panel, Einstellung, Fake-Manager und Stub zurücksetzen");
  try {
    const v = await bereiteVor(cdp);
    farbklasse = await cdp.evaluate<string>(`return document.body.className;`);
    await setWindowSize(cdp, 1400, 1000);
    await raeume();
    await stelleFixturenHer();
    await lauf("plugin-geladen", async () => {
      record("plugin-geladen", true, `${v.hinweis} · ${v.neu} · Obsidian ${v.version ?? "?"}${v.versionPasst === false ? " (NICHT 1.15)" : ""}`);
    });

    await punktBlock();
    await punktLaufzeitSchutz();
    await punktBomUndKosten();
    await punktPanelTeuerBraucht();
    await punktEinbettung();
    await punktKnopfOeffnetPanel();
    await punktSchnappschuss();
    await punktErzeugen();
    await punktRueckfrage();
    await punktSchattenwurzel();
    await punktFokusUndErreichbarkeit();
    await punktUebernehmenDatei();
    await punktUebernehmenBlock();
    await punktBlockVerschoben();
    await punktLesemodus();
    await punktSperre();
    await punktAuswahl();
    await punktBestand();
    await punktNichtzeichen();
    await punktSchliessen();
    await punktRandfaelle();
    await punktPruefliste();
    await punktFelder();

    if (gewaehlt("rest11-folgerunde-nach-namen-vergeben")) skipped("rest11-folgerunde-nach-namen-vergeben", "nur von Hand prüfbar: eine Folgerunde nach „Namen vergeben“ braucht ein Modell, das auf den neu vergebenen ids aufbaut, und eine Handänderung dazwischen; der Stub belegt das nicht (C4-Rest 11, mit Johannes durchspielen)");
    if (gewaehlt("mobil-geraet-tastatur")) skipped("mobil-geraet-tastatur", "am Gerät zu messen (iPhone, Web-Inspektor, Tastatur offen): Auftrag des Masters, Plan „Mobil am Gerät“ M4 bis M6; die Emulation hat keine Bildschirmtastatur");

    await raeume();
    if (gewaehlt("mobil-emulation", "mobil-trefflaeche-44px", "mobil-pruefliste-trefflaeche-44px", "mobil-felder", "mobil-tastaturabstand")) await punktMobil();
    // Zuletzt: der Punkt beendet die Instanz hart und startet sie neu; alles danach liefe gegen eine andere Instanz.
    neuGestartet = await punktBeendenImWachfenster();
    neuGestartet = (await punktAbsturzNeustart()) || neuGestartet;
    if (nur !== null) for (const n of PUNKTE) if (!bilanz.eintraege().some((p) => p.name === n)) skipped(n, "nicht gewählt (--nur, Entwicklungslauf)");
  } finally {
    await zustand.schliesse();
    if (!istAbgebrochen()) {
      try { await raeume(); } catch { /* die Instanz wird beendet, der Staging-Vault wird beim nächsten Lauf neu gebaut */ }
    }
  }
  if (istAbgebrochen()) return;
  cdp.close();
  // Die neu gestartete Instanz gehört nicht mehr dem Aufrufer (messlauf.sh kennt nur die erste PID): hier beenden, nur über den vollen Profilpfad.
  if (neuGestartet) {
    try { execFileSync("pkill", ["-f", `user-data-dir=${process.env.UD ?? "/nonexistent"}`]); } catch { /* schon weg */ }
  }
  bilanz.abschluss();
}

runDriver(main);
