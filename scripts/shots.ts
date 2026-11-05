/**
 * Aufnahme-Treiber für die README-Bilder von svg-studio — fährt den Vertrag aus `docs/images/README.md` gegen eine LAUFENDE Zweitinstanz.
 *
 * Das LLM ist ein Stub: ein lokaler Server hinter einem Fake-Manager (`llm-endpoint-manager`), dessen Antworten das Rezept vorgibt (die Zeichnung steht im
 * Fixture, die Änderungen sind Textersetzungen darauf). Die Bilder zeigen die Oberfläche, nie die Qualität einer Modellantwort; die Messung dazu steht in
 * `docs/internal/LAB.md`. Die Primitive (Panel bedienen, tippen, senden, im Bild klicken) sind eine Kurzfassung derer aus `scripts/gui-smoke.ts`.
 *
 * ## Aufruf (Zweitinstanz, nie die reguläre; `--port` ist Pflicht)
 *
 *   npm run build && npm run shots -- --setup          # Vault aus docs/images/fixture/ nach $STAGING_VAULTS_DIR bauen
 *   # Zweitinstanz mit eigenem Profil starten (Profil, obsidian.json, .asar, --lang=en-US: Kopf von tools/obsidian-cdp/messlauf.sh im Dach), dann:
 *   npm run shots -- --port 9660                       # alle Bilder
 *   npm run shots -- --port 9660 --only hero.png       # eines nachziehen
 *   npm run shots -- --list                            # Vertrag anzeigen
 *
 * Der Lock des Dachs (`--exclusive focus`, Bildaufnahme) gehört vor den Lauf (`.claude/rules/cdp-lock.md`). `npm run shots` baut und deployt nicht: das Setup kopiert das
 * gebaute `main.js` in den Vault, `ladePluginNeu` prüft es gegen `src/`.
 */
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";

import {
  Cdp,
  attachTo,
  bereiteInstanzVor,
  clearNotices,
  clickReal,
  installFakeManager,
  entferneFakeManager,
  ladePluginNeu,
  openExisting,
  pollUntil,
  requireVisible,
  schliesseDialog,
  setAppConfig,
  setPluginSetting,
} from "../../tools/obsidian-cdp/cdp.js";
import { startLlmStub, type LlmStub } from "../../tools/obsidian-cdp/llm-stub.js";
import { boxOf, capture, setWindowSize, writeShot, type Rect } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "svg-studio";
const PLUGIN_ID = "svg-studio";
const VIEW_TYPE = "svg-studio-panel";
const MANAGER_ID = "llm-endpoint-manager";
const OUT_DIR = "docs/images";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
/** Fensterbreite und -höhe der Aufnahme (CSS-Pixel); die Seitenleiste bekommt je Bild ihre Breite. */
const FENSTER_B = 1200;
const FENSTER_H = 940;
const DPR = 2;

const q = (s: unknown): string => JSON.stringify(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "docs/images/fixture");

// ── Stub-Antworten: Textersetzungen auf der Zeichnung im Fixture ───────────────────────────────────────────────────────────────────────────

const NOTIZ_ZIMMER = "Living room.md";
const NOTIZ_KAPUTT = "Broken block.md";
const fixtur = (name: string): string => readFileSync(join(FIXTURE_DIR, "notes", name), "utf8");

/** Der Quelltext des ersten ```svg-studio-Blocks der Notiz (Zeilen zwischen den Zäunen). */
function blockQuelle(note: string): string {
  const m = /```svg-studio\n([\s\S]*?)\n```/.exec(note);
  if (m === null) throw new Error("Fixture-Notiz ohne svg-studio-Block");
  return m[1]!;
}
/** Ersetzt genau eine Stelle; fehlt sie, ist das Fixture gegen das Rezept veraltet (Abbruch statt stiller Abweichung). */
function ersetze(text: string, von: string, nach: string): string {
  if (!text.includes(von)) throw new Error(`Stub-Antwort: „${von}“ steht nicht in der Vorlage`);
  return text.replace(von, nach);
}
const PLAN = blockQuelle(fixtur(NOTIZ_ZIMMER));
/** Die Änderungswünsche des Bildes `review.png`: Tür nach links (x), Nordwand dicker (stroke-width), Südwand dunkelblau (stroke). */
const TUER: readonly [string, string] = [`id="door" x="235"`, `id="door" x="215"`];
const NORD: readonly [string, string] = [`id="wall-north" x1="0" y1="0" x2="560" y2="0" stroke="black" stroke-width="2"`, `id="wall-north" x1="0" y1="0" x2="560" y2="0" stroke="black" stroke-width="6"`];
const SUED: readonly [string, string] = [`id="wall-south" x1="560" y1="300" x2="0" y2="300" stroke="black"`, `id="wall-south" x1="560" y1="300" x2="0" y2="300" stroke="#1d4e89"`];
const ANTWORT_ERZEUGEN = PLAN;
const ANTWORT_AENDERN = [TUER, NORD, SUED].reduce((t, [von, nach]) => ersetze(t, von, nach), PLAN);
const PROMPT_ERZEUGEN = "A floor plan of a room, 5.6 × 3.0 m, door 90 cm wide in the north wall, one window in the east wall.";
const PROMPT_AENDERN = "Move the door 20 cm to the left, make the north wall thicker and the south wall dark blue.";
const ENDPUNKT = { id: "demo", label: "Demo endpoint", modell: "demo-model" };

// ── Zustand ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

let stub: LlmStub;
let port = 0;

interface Snap {
  target: string | null;
  statusClass: string;
  status: string | null;
  rounds: number;
  running: boolean;
  previewHidden: boolean;
  measure: string | null;
  svgIds: string[] | null;
  cards: number;
  rejected: number;
  fieldsHead: string | null;
  notices: string[];
}

const SNAP_JS = `
  const root = document.querySelector(".svg-studio-panel");
  if (!root) return null;
  const txt = (s) => { const e = root.querySelector(s); return e ? (e.textContent || "").trim() : null; };
  const stage = root.querySelector(".svg-studio-stage");
  const svg = stage && stage.shadowRoot ? stage.shadowRoot.querySelector("svg") : null;
  const stop = root.querySelector(".svg-studio-stop");
  const prev = root.querySelector(".svg-studio-preview");
  const status = root.querySelector(".svg-studio-status");
  const leaf = app.workspace.getLeavesOfType("svg-studio-panel")[0];
  const sit = leaf && leaf.view && leaf.view.state ? leaf.view.state() : null;
  return {
    target: txt(".svg-studio-target"),
    statusClass: status ? status.className : "",
    status: txt(".svg-studio-status"),
    rounds: sit ? sit.rounds.rounds.length : 0,
    running: stop ? !stop.classList.contains("is-hidden") : false,
    previewHidden: prev ? prev.classList.contains("is-hidden") : true,
    measure: txt(".svg-studio-measure"),
    svgIds: svg ? Array.from(svg.querySelectorAll("[id]")).map((e) => e.getAttribute("id")) : null,
    cards: root.querySelectorAll(".svg-studio-changes .okit-review-card").length,
    rejected: root.querySelectorAll(".svg-studio-changes .okit-review-card.is-rejected").length,
    fieldsHead: txt(".svg-studio-fields-head"),
    notices: Array.from(root.querySelectorAll(".svg-studio-notice")).map((n) => (n.textContent || "").trim()),
  };
`;
const snap = (cdp: Cdp): Promise<Snap | null> => cdp.evaluate<Snap | null>(SNAP_JS);

async function warteSnap(cdp: Cdp, ok: (s: Snap) => boolean, ms = 15000): Promise<Snap | null> {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    const s = await snap(cdp);
    if (s !== null && ok(s)) return s;
    await sleep(150);
  }
  return null;
}

/** Klick mit vorherigem Rollen ohne Animation (die weiche Bewegung der Brücke trifft sonst den Behälter statt des Knopfs). */
async function klick(cdp: Cdp, ausdruck: string): Promise<boolean> {
  await cdp.evaluate(`const el = ${ausdruck}; if (el) el.scrollIntoView({ block: "center", behavior: "instant" }); return true;`);
  await sleep(250);
  return clickReal(cdp, ausdruck);
}

async function tippe(cdp: Cdp, text: string): Promise<void> {
  await cdp.evaluate(`const el = document.querySelector(".svg-studio-input"); el.focus(); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
  await cdp.send("Input.insertText", { text });
  const wert = await cdp.evaluate<string>(`return document.querySelector(".svg-studio-input").value;`);
  if (wert !== text) throw new Error(`Eingabefeld enthält „${wert}“ statt des Prompts`);
}

/** Prompt tippen, senden, auf die neue Runde warten. */
async function frage(cdp: Cdp, text: string, ms = 30000): Promise<Snap> {
  const vorher = (await snap(cdp))?.rounds ?? 0;
  await tippe(cdp, text);
  if (!(await klick(cdp, `document.querySelector(".svg-studio-send")`))) throw new Error("Senden-Knopf nicht klickbar");
  const s = await warteSnap(cdp, (x) => x.rounds > vorher || (x.statusClass.includes("is-error") && !x.running), ms);
  if (s === null || s.rounds <= vorher) throw new Error(`Keine neue Runde nach dem Senden (Status ${q(s?.status ?? (await snap(cdp))?.status)}; Stub ${q(stub.zaehler())})`);
  return s;
}

const kartenKnopf = (re: RegExp, knopf: string): string =>
  `(() => { const c = Array.from(document.querySelectorAll(".svg-studio-changes .okit-review-card")).find((x) => new RegExp(${q(re.source)}, ${q(re.flags)}).test((x.querySelector(".okit-review-main") || {}).innerText || "")); return c ? c.querySelector(${q(knopf)}) : null; })()`;

const IM_BILD = (id: string): string =>
  `(() => { const st = document.querySelector(".svg-studio-stage"); const svg = st && st.shadowRoot ? st.shadowRoot.querySelector("svg") : null; return svg ? Array.from(svg.querySelectorAll("[id]")).find((e) => e.getAttribute("id") === ${q(id)}) : null; })()`;

/** Echter Mausklick auf ein Element in der Vorschau; wartet, bis die Zahlenfelder dieses Elements da sind. */
async function klickImBild(cdp: Cdp, id: string): Promise<Snap> {
  if (!(await klick(cdp, IM_BILD(id)))) throw new Error(`Element ${id} in der Vorschau nicht klickbar`);
  const s = await warteSnap(cdp, (x) => (x.fieldsHead ?? "").includes(id), 5000);
  if (s === null) throw new Error(`Nach dem Klick auf ${id} zeigt das Panel keine Felder`);
  return s;
}

/** Notiz im Lesemodus öffnen und auf das sichtbare Bild des Blocks warten. */
async function oeffneNotiz(cdp: Cdp, pfad: string, selektor: string): Promise<void> {
  if (!(await openExisting(cdp, pfad, "preview"))) throw new Error(`${pfad} ließ sich nicht öffnen`);
  const da = await pollUntil<boolean>(cdp, `return Array.from(document.querySelectorAll(${q(selektor)})).some((e) => e.getBoundingClientRect().width > 1) ? true : null;`, 10000, 250);
  if (!da) {
    const lage = await cdp.evaluate<string>(`return JSON.stringify({
      datei: app.workspace.getActiveFile()?.path ?? null,
      bloecke: document.querySelectorAll(".svg-studio-block").length,
      fehler: Array.from(document.querySelectorAll(".svg-studio-error, .svg-studio-held")).map((e) => (e.textContent || "").slice(0, 160)),
      lesefaeche: (document.querySelector(".markdown-reading-view")?.textContent ?? "").length,
    });`);
    throw new Error(`In ${pfad} erscheint ${selektor} nicht — ${lage}`);
  }
}

/** Das Panel über den Stift am Block (wie ein Nutzer). */
async function oeffneBlockImPanel(cdp: Cdp): Promise<Snap> {
  await oeffneNotiz(cdp, NOTIZ_ZIMMER, ".markdown-preview-view img.svg-studio-img");
  const stift = `Array.from(document.querySelectorAll(".markdown-preview-view .svg-studio-block > .svg-studio-edit")).find((b) => b.getBoundingClientRect().width > 0)`;
  if (!(await klick(cdp, `(${stift})`))) throw new Error("Stift am Block nicht klickbar");
  const s = await warteSnap(cdp, (x) => (x.target ?? "").startsWith("Edit") && !x.previewHidden && x.svgIds !== null, 10000);
  if (s === null) throw new Error("Das Panel kam nach dem Klick auf den Stift nicht hoch");
  return s;
}

async function oeffneNeuesPanel(cdp: Cdp): Promise<Snap> {
  await cdp.evaluate(`app.commands.executeCommandById("${PLUGIN_ID}:new-svg"); return true;`);
  const s = await warteSnap(cdp, (x) => x.target !== null, 10000);
  if (s === null) throw new Error("Das Panel kam nach „New SVG“ nicht hoch");
  return s;
}

/** Auf einen sauberen Ausgang: Dialoge zu, Panel zu (offene Runden verworfen), Notizen zu, Stub leer, Seitenleisten ein. */
async function raeume(cdp: Cdp): Promise<void> {
  await clearNotices(cdp);
  await schliesseDialog(cdp, { fristMs: 500 }).catch(() => undefined);
  await cdp.evaluate(`for (const l of app.workspace.getLeavesOfType(${q(VIEW_TYPE)})) l.detach(); return true;`);
  const dlg = await pollUntil<boolean>(cdp, `const b = Array.from(document.querySelectorAll(".modal-container .modal-button-container button")).find((x) => /discard/i.test(x.textContent || "")); if (b) { b.click(); return true; } return null;`, 1200, 150);
  if (dlg) await sleep(300);
  await cdp.evaluate(`const alle = []; app.workspace.iterateRootLeaves((l) => alle.push(l)); for (const l of alle) l.detach(); return true;`);
  await sleep(500);
  stub.antworten([]);
  stub.loescheMitschnitt();
}

/** Breite der rechten Seitenleiste setzen (`setSize` der Seitenleiste; ein Stil von Hand greift erst beim nächsten Layout) und zurücklesen. */
async function setzeSeitenleiste(cdp: Cdp, breite: number): Promise<number> {
  // Erst aufklappen und warten, dann die Breite setzen: `setSize` mitten im Aufklappen (Animation) verpufft und die Breite des vorigen Bildes bleibt stehen.
  await cdp.evaluate(`app.workspace.rightSplit.expand(); return true;`);
  await pollUntil<number>(cdp, `const w = app.workspace.rightSplit.containerEl.getBoundingClientRect().width; return w > 100 ? w : null;`, 5000, 150);
  await sleep(600);
  await cdp.evaluate(`app.workspace.rightSplit.setSize(${breite}); return true;`);
  const b = await pollUntil<number>(cdp, `const w = app.workspace.rightSplit.containerEl.getBoundingClientRect().width; return Math.abs(w - ${breite}) <= 2 ? w : null;`, 5000, 150);
  await sleep(300);
  return b ?? 0;
}

/** Linke Seitenleiste zu, rechte auf `breite`: die Aufnahme zeigt Notiz und Panel, keine Dateiliste. */
async function layout(cdp: Cdp, breite: number): Promise<void> {
  await cdp.evaluate(`app.workspace.leftSplit.collapse(); return true;`);
  const ist = await setzeSeitenleiste(cdp, breite);
  if (Math.abs(ist - breite) > 4) console.log(`      · Seitenleiste ${Math.round(ist)} px statt ${breite} px`);
  await sleep(400);
}

// ── Rezept ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Shot {
  name: string;
  /** Klasse nach dem Bild-Standard — steuert, ob ein Vorschaubild entsteht. */
  klasse: "hero" | "feature" | "detail";
  /** Stellt den Zustand her und liefert den Bildausschnitt (null = nicht aufnehmbar). */
  run(cdp: Cdp): Promise<Rect | null>;
  /** Nach der Aufnahme (auch nach einem Fehler): ein Bild darf den Zustand nicht dem nächsten hinterlassen. */
  danach?(cdp: Cdp): Promise<void>;
}

/** Der ganze Inhalt des Fensters: ohne Ribbon und Statusleiste, wie Notiz und Panel nebeneinander stehen. */
async function arbeitsflaeche(cdp: Cdp): Promise<Rect | null> {
  const w = await boxOf(cdp, ".workspace");
  return w;
}

/** Das Panel allein, bis zur Unterkante seines letzten sichtbaren Inhalts. */
async function panelBox(cdp: Cdp): Promise<Rect | null> {
  const leaf = await boxOf(cdp, `.workspace-leaf-content[data-type="${VIEW_TYPE}"]`);
  if (leaf === null) return null;
  const unten = await cdp.evaluate<number>(`
    const p = document.querySelector(".svg-studio-panel");
    let max = 0;
    for (const el of p.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.width > 0 && getComputedStyle(el).visibility !== "hidden") max = Math.max(max, r.bottom);
    }
    return max;
  `);
  return { ...leaf, height: Math.max(1, Math.min(leaf.height, unten - leaf.y + 14)) };
}

/** Das Panel rollt: Vorschau und Prüfliste gehören zusammen ins Bild, der Kopf mit Modellzeile und Eingabe darf oben herausrollen. */
async function rolleZurVorschau(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const p = document.querySelector(".svg-studio-panel");
    const cap = p.querySelector(".svg-studio-preview-caption");
    p.scrollTop = cap.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - 8;
    return true;
  `);
  await sleep(400);
}

const SHOTS: Shot[] = [
  {
    name: "hero.png",
    klasse: "hero",
    async run(cdp) {
      await raeume(cdp);
      await layout(cdp, 560);
      stub.antworten([ANTWORT_AENDERN]);
      await oeffneBlockImPanel(cdp);
      await frage(cdp, PROMPT_AENDERN);
      await rolleZurVorschau(cdp);
      await sleep(600);
      return arbeitsflaeche(cdp);
    },
  },
  {
    name: "create.png",
    klasse: "feature",
    async run(cdp) {
      await raeume(cdp);
      await layout(cdp, 600);
      stub.antworten([ANTWORT_ERZEUGEN]);
      await oeffneNeuesPanel(cdp);
      await frage(cdp, PROMPT_ERZEUGEN);
      await sleep(600);
      return panelBox(cdp);
    },
  },
  {
    name: "review.png",
    klasse: "feature",
    async run(cdp) {
      await raeume(cdp);
      await layout(cdp, 600);
      // Das Panel ist mit drei Karten höher als der Bildschirm (949 px) erlaubt: ein hoher virtueller Viewport, nur für diese Aufnahme, damit „Apply“ unter den Karten ins Bild kommt.
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: FENSTER_B, height: 1500, deviceScaleFactor: DPR, mobile: false });
      await sleep(600);
      stub.antworten([ANTWORT_AENDERN]);
      await oeffneBlockImPanel(cdp);
      const s = await frage(cdp, PROMPT_AENDERN);
      if (s.cards !== 3) throw new Error(`Erwartet drei Karten, das Panel zeigt ${s.cards}`);
      // Eine Karte ablehnen: das Bild zeigt beide Entscheidungen, nicht nur die Voreinstellung „angenommen“.
      if (!(await klick(cdp, kartenKnopf(/door/, ".okit-review-reject")))) throw new Error("Ablehnen-Knopf der Tür-Karte nicht klickbar");
      if ((await warteSnap(cdp, (x) => x.rejected === 1, 5000)) === null) throw new Error("Die Tür-Karte zeigt nicht „abgelehnt“");
      await cdp.evaluate(`const p = document.querySelector(".svg-studio-panel"); p.scrollTop = 0; return true;`);
      await sleep(600);
      // Von der Beschriftung der Vorschau bis unter „Apply“: der Kopf mit Modellzeile und Eingabe bleibt weg.
      return cdp.evaluate<Rect | null>(`
        const leaf = document.querySelector('.workspace-leaf-content[data-type="${VIEW_TYPE}"]').getBoundingClientRect();
        const cap = document.querySelector(".svg-studio-preview-caption").getBoundingClientRect();
        const acc = document.querySelector(".svg-studio-accept").getBoundingClientRect();
        return { x: leaf.left, y: cap.top - 4, width: leaf.width, height: acc.bottom - cap.top + 20 };
      `);
    },
    async danach(cdp) {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
    },
  },
  {
    name: "fields.png",
    klasse: "feature",
    async run(cdp) {
      await raeume(cdp);
      await layout(cdp, 600);
      await oeffneBlockImPanel(cdp);
      await klickImBild(cdp, "sofa");
      await sleep(600);
      return panelBox(cdp);
    },
  },
  {
    name: "repair.png",
    klasse: "feature",
    async run(cdp) {
      await raeume(cdp);
      await layout(cdp, 400);
      await oeffneNotiz(cdp, NOTIZ_KAPUTT, ".markdown-preview-view .svg-studio-error");
      await cdp.evaluate(`app.workspace.rightSplit.collapse(); return true;`);
      await sleep(500);
      // Von der Überschrift bis unter die Knöpfe und bis zum Ende des Satzes: der Rest der Lesefläche ist Leere.
      return cdp.evaluate<Rect | null>(`
        const s = document.querySelector(".markdown-preview-view .markdown-preview-sizer").getBoundingClientRect();
        const h = document.querySelector(".markdown-preview-view h1").getBoundingClientRect();
        const a = document.querySelector(".markdown-preview-view .svg-studio-error").getBoundingClientRect();
        const p = document.querySelector(".markdown-preview-view p");
        const r = document.createRange(); r.selectNodeContents(p);
        const rechts = Math.max(a.right, r.getBoundingClientRect().right);
        const links = Math.max(0, s.left - 16);
        return { x: links, y: Math.max(0, h.top - 16), width: rechts - links + 24, height: a.bottom - h.top + 32 };
      `);
    },
  },
];

// ── Verbindung ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function bereiteVor(cdp: Cdp): Promise<void> {
  await requireVisible(cdp);
  const klar = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: REPO_NAME, sprache: "en", erwarteteVersion: "1.15" });
  console.log(`  ${klar.hinweis}; Obsidian ${klar.version ?? "?"}${klar.versionPasst === false ? " (NICHT 1.15)" : ""}`);
  const neu = await ladePluginNeu(cdp, PLUGIN_ID, { repoMainJs: join(REPO_ROOT, "main.js"), sprache: "en", melde: (m) => console.log(`  ! ${m}`) });
  if (!neu.geladen) throw new Error(`Plugin nicht aktiv — ${neu.hinweis}`);
  if (!neu.aktuell) throw new Error(neu.hinweis);
  const fm = await installFakeManager(cdp, {
    pluginId: MANAGER_ID,
    invalidiere: [PLUGIN_ID],
    endpunkte: [{ id: ENDPUNKT.id, label: ENDPUNKT.label, url: stub.url, models: [ENDPUNKT.modell], defaultModel: ENDPUNKT.modell, capabilities: ["chat"] }],
  });
  if (!fm.installiert) throw new Error(`Fake-Manager nicht eingebaut: ${fm.grund ?? "?"}`);
}

async function main(): Promise<void> {
  const outDir = join(REPO_ROOT, OUT_DIR);

  if (argv.includes("--list")) {
    for (const s of SHOTS) console.log(`  ${s.klasse.padEnd(8)} ${s.name}`);
    return;
  }

  if (argv.includes("--setup")) {
    const vaultDir = stagingVaultDir(REPO_NAME);
    console.log(`Aufnahme-Vault: ${vaultDir}`);
    for (const zeile of buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE_DIR, pluginId: PLUGIN_ID })) console.log(`  ${zeile}`);
    console.log(
      "\nLief eine Zweitinstanz während dieses Setups, muss sie JETZT neu starten (--setup ersetzt Notizen, Layout und Einstellungen).\n" +
      "Die Zweitinstanz bekommt ein eigenes Profil und einen eigenen Port; die reguläre Instanz wird nie beendet. Dann: npm run shots -- --port <port>",
    );
    return;
  }

  port = Number(flag("--port") ?? env.SHOTS_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port <1024-65535> ist Pflicht (kein Standardport: 9222 gehört der regulären Instanz).");
  const nur = flag("--only");
  if (nur !== undefined && !SHOTS.some((s) => s.name === nur)) throw new Error(`--only: unbekanntes Bild ${nur} (--list zeigt den Vertrag)`);
  mkdirSync(outDir, { recursive: true });

  const cdp = await attachTo("workspace", port, REPO_NAME);
  if (cdp === null) throw new Error(`Kein Obsidian-Hauptfenster mit dem Vault „${REPO_NAME}“ auf Port ${port} (Zweitinstanz mit eigenem Profil starten, Rezept im Kopf).`);
  console.log(`Verbunden auf Port ${port}.\n`);
  await cdp.mitschnitt((zeile) => console.log(`      » ${zeile.slice(0, 300)}`));
  stub = await startLlmStub({ models: [ENDPUNKT.modell] });
  let ok = 0;
  let fehlend = 0;
  try {
    await bereiteVor(cdp);
    await setWindowSize(cdp, FENSTER_B, FENSTER_H);
    // Zur Laufzeit, nicht über die Fixture-Datei: ein laufendes Obsidian liest sie nicht neu.
    await setAppConfig(cdp, "readableLineLength", false);
    await setAppConfig(cdp, "showInlineTitle", false);
    // Die Statusleiste (Sync-Symbol) schwebt in der Ecke und fiele in jeden Ausschnitt; sie gehört nicht zum Plugin.
    await cdp.evaluate(`const s = document.querySelector(".status-bar"); if (s) s.style.display = "none"; return true;`);
    await cdp.evaluate(`document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light"); app.workspace.trigger("css-change"); return true;`);
    await setPluginSetting(cdp, PLUGIN_ID, "acceptAs", "file");
    await raeume(cdp);

    for (const shot of SHOTS) {
      if (nur !== undefined && shot.name !== nur) continue;
      try {
        const box = await shot.run(cdp);
        const png = box ? await capture(cdp, box, DPR) : null;
        await shot.danach?.(cdp);
        if (!png) {
          console.log(`  ✗ ${shot.name} — Zustand kam nicht zustande`);
          fehlend++;
          continue;
        }
        console.log(`  ✓ ${await writeShot(cdp, shot.name, png, { outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH, thumb: shot.klasse === "detail" })}`);
        ok++;
      } catch (err) {
        await shot.danach?.(cdp).catch(() => undefined);
        console.log(`  ✗ ${shot.name} — ${(err as Error).message}`);
        fehlend++;
      }
    }
  } finally {
    try {
      await raeume(cdp);
      await entferneFakeManager(cdp, { pluginId: MANAGER_ID, invalidiere: [PLUGIN_ID] });
    } catch { console.log("  ! Aufräumen im Renderer fehlgeschlagen — Staging-Vault von Hand prüfen"); }
    await stub.stop().catch(() => undefined);
    cdp.close();
  }
  console.log(`\n${ok} Bild(er) geschrieben, ${fehlend} offen.`);
  if (fehlend) exit(1);
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
