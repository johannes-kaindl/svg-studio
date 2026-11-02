// svg-lab: Messung lokaler Modelle für SVG Studio (Spec § 10). LAB-CODE: läuft außerhalb des Gates (`npm run lab -- …`), nie in `npm test`.
//
//   Messlauf:   npm run lab -- --endpoint http://localhost:1234/v1 --model <id> [--phase erzeugen|verfeinern|alles] [--nur E8,V3]
//   Auswerten:  npm run lab -- --auswerten [--json] [--dir <ordner mit *.jsonl>]
//   Stand:      npm run lab -- --status
//
// Der Messlauf schickt jeden Fall STRIKT nacheinander an einen OpenAI-kompatiblen Endpunkt (nicht streamend) und hängt eine
// JSONL-Zeile an `tests/fixtures/lab/<modell-slug>-<form>.jsonl` (`form` = Antwortform `svg` | `json`). Wiederaufnahme: schon
// vorhandene Fälle (Modell, Fall, Form) werden übersprungen. Eine Anfrage wird nie vor Ablauf von 15 Minuten abgebrochen; ein
// Transportfehler beendet den Lauf, ohne eine Zeile zu schreiben (der Endpunkt könnte tot sein: erst nachsehen, dann neu starten).
// Dieses Skript lädt kein Modell; es fragt nur, was der Endpunkt gerade bedient.
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyChanges } from "../src/core/changes";
import { scanElements } from "../src/core/elements";
import {
  decomposable, extractChanges, extractSvg, idQuote, judgeEntries, pairElements,
  type Allowed, type Pairing, type Unrequested,
} from "./lab/analyse";
import { runPage, type PageCheck, type PageJob, type PageResult } from "./lab/chrome";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAB_DIR = join(ROOT, "scripts", "lab");

/** Sampling: Modus `transform` aus code-kit `sampling-profiles` (MODES.transform: temperature 0.2, thinking off). Nicht vendort, weil
 *  das Modul eine Familienauflösung mitbringt, die ein Messskript nicht braucht; Spec § 10 lässt die Messung den Modus bestätigen.
 *  Überschreibbar mit --temperature. `reasoning_effort` ist STANDARDMÄSSIG `none` (Produktmodus transform = Denken aus; Pilot 2026-11-02:
 *  E1 mit Qwen in 12,7 s statt über 10 Minuten mit Denken); `--effort <x>` überschreibt, `--effort weglassen` sendet das Feld nicht. */
const DEFAULT_EFFORT = "none";
const TRANSFORM_TEMPERATURE = 0.2;
/** Obergrenze je Anfrage: 15 Minuten, nie kürzer. */
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

// ---------- Typen ----------

interface CreateCase { id: string; slug: string; art: string; prompt: string; messen?: PageJob["messen"] }
interface RefineCase { id: string; basis: string; prompt: string; erlaubt: Allowed; prueft: Array<Record<string, unknown>> }
interface Prompts { erzeugen: CreateCase[]; verfeinern: RefineCase[] }
type Form = "svg" | "json";

interface LabRecord {
  case: string;
  form: Form;
  model: string;
  prompt: string;
  raw: string;
  ms: number;
  /** Nur wenn der Ausgang das Ergebnis des ANDEREN Modells ist: dessen Modellkennung. */
  base?: string;
  /** Beim Verfeinern: der Ausgangs-SVG-Text (Fixture für diff.ts/protocol.ts in Plan 2). */
  input?: string;
  finish?: string;
  usage?: unknown;
  reasoningChars?: number;
  /** Sampling-Einstellungen des Laufs (Spec § 10: die Messung bestätigt den Modus). */
  temperature?: number;
  effort?: string | null;
  max_tokens?: number;
}

// ---------- Argumente ----------

interface Args {
  endpoint: string; model: string; phase: "erzeugen" | "verfeinern" | "alles"; nur: Set<string> | null; dir: string;
  auswerten: boolean; status: boolean; json: boolean; temperature: number; maxTokens: number; effort: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { endpoint: "http://localhost:1234/v1", model: "", phase: "alles", nur: null, dir: join(ROOT, "tests", "fixtures", "lab"), auswerten: false, status: false, json: false, temperature: TRANSFORM_TEMPERATURE, maxTokens: 16384, effort: DEFAULT_EFFORT };
  const next = (i: number, name: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} braucht einen Wert`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--") continue;
    else if (k === "--endpoint") a.endpoint = next(i++, k);
    else if (k === "--model") a.model = next(i++, k);
    else if (k === "--phase") a.phase = next(i++, k) as Args["phase"];
    else if (k === "--nur") a.nur = new Set(next(i++, k).split(",").map((s) => s.trim()).filter(Boolean));
    else if (k === "--dir") a.dir = resolve(next(i++, k));
    else if (k === "--temperature") a.temperature = Number(next(i++, k));
    else if (k === "--max-tokens") a.maxTokens = Number(next(i++, k));
    else if (k === "--effort") { const v = next(i++, k); a.effort = v === "weglassen" ? null : v; }
    else if (k === "--auswerten") a.auswerten = true;
    else if (k === "--status") a.status = true;
    else if (k === "--json") a.json = true;
    else throw new Error(`unbekannte Option ${k}`);
  }
  if (!["erzeugen", "verfeinern", "alles"].includes(a.phase)) throw new Error("--phase: erzeugen | verfeinern | alles");
  return a;
}

// ---------- Einlesen ----------

async function loadPrompts(): Promise<Prompts> {
  return JSON.parse(await readFile(join(LAB_DIR, "prompts.json"), "utf8")) as Prompts;
}

async function loadSystem(): Promise<{ erzeugen: string; svg: string; json: string }> {
  const md = await readFile(join(LAB_DIR, "system-prompt.md"), "utf8");
  const sec = new Map<string, string>();
  const parts = md.split(/^## (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) sec.set(parts[i].trim(), parts[i + 1].trim());
  const get = (n: string): string => {
    const s = sec.get(n);
    if (s === undefined) throw new Error(`system-prompt.md: Abschnitt "${n}" fehlt`);
    return s;
  };
  const common = get("Gemeinsam");
  return {
    erzeugen: `${common}\n\n${get("Erzeugen")}`,
    svg: `${common}\n\n${get("Verfeinern (vollständiges SVG)")}`,
    json: `${common}\n\n${get("Verfeinern (Änderungsliste)")}`,
  };
}

async function loadRecords(dir: string): Promise<LabRecord[]> {
  if (!existsSync(dir)) return [];
  const out: LabRecord[] = [];
  for (const f of (await readdir(dir)).filter((n) => n.endsWith(".jsonl")).sort()) {
    for (const line of (await readFile(join(dir, f), "utf8")).split("\n")) {
      if (line.trim() === "") continue;
      try {
        const r = JSON.parse(line) as LabRecord;
        if (typeof r.case === "string" && typeof r.model === "string" && typeof r.raw === "string") out.push(r);
      } catch { /* kaputte Zeile (abgebrochenes Schreiben) überspringen */ }
    }
  }
  return out;
}

export function slug(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}
const keyOf = (model: string, c: string, form: Form): string => `${model}\u0000${c}\u0000${form}`;

// ---------- Anfrage ----------

/** POST mit node:http statt fetch: undici bricht eine nicht streamende Anfrage nach 300 s ohne Antwort-Kopf ab (headersTimeout),
 *  ein 27B-Modell braucht für einen Grundriss länger. Hier gilt allein der Socket-Timeout von 15 Minuten. */
function post(url: string, body: string): Promise<{ status: number; text: string }> {
  return new Promise((ok, fail) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }, timeout: REQUEST_TIMEOUT_MS, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", fail);
    });
    req.on("timeout", () => req.destroy(new Error(`Zeitüberschreitung nach ${REQUEST_TIMEOUT_MS / 60000} Minuten`)));
    req.on("error", fail);
    req.write(body);
    req.end();
  });
}

async function chat(args: Args, system: string, user: string): Promise<{ raw: string; finish?: string; usage?: unknown; reasoningChars?: number }> {
  const body: Record<string, unknown> = {
    model: args.model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    stream: false,
  };
  if (args.effort !== null) body.reasoning_effort = args.effort;
  const res = await post(`${args.endpoint.replace(/\/+$/, "")}/chat/completions`, JSON.stringify(body));
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${res.text.slice(0, 300)}`);
  const j = JSON.parse(res.text) as { choices?: Array<{ message?: { content?: string | null; reasoning_content?: string; reasoning?: string }; finish_reason?: string }>; usage?: unknown };
  const msg = j.choices?.[0]?.message;
  const reasoning = msg?.reasoning_content ?? msg?.reasoning;
  return { raw: msg?.content ?? "", finish: j.choices?.[0]?.finish_reason, usage: j.usage, ...(reasoning ? { reasoningChars: reasoning.length } : {}) };
}

// ---------- Messlauf ----------

/** Ist das Ergebnis eines Erzeugen-Falls als Ausgang brauchbar (wohlgeformt UND vom Bereiniger durchgelassen)? */
async function validBases(recs: LabRecord[]): Promise<Map<string, string | null>> {
  const creates = recs.filter((r) => r.form === "svg" && r.case.startsWith("E"));
  const jobs: PageJob[] = [];
  const texts = new Map<string, string>();
  for (const r of creates) {
    const ex = extractSvg(r.raw);
    if (ex.value !== null) { const k = keyOf(r.model, r.case, "svg"); texts.set(k, ex.value); jobs.push({ key: k, svg: ex.value }); }
  }
  const res = await runPage(jobs);
  const out = new Map<string, string | null>();
  for (const r of creates) out.set(keyOf(r.model, r.case, "svg"), null);
  for (const p of res) out.set(p.key, p.parseOk && p.guard.ok ? (texts.get(p.key) ?? null) : null);
  return out;
}

async function lauf(args: Args): Promise<void> {
  if (args.model === "") throw new Error("--model <id> fehlt");
  const prompts = await loadPrompts();
  const sys = await loadSystem();
  await mkdir(args.dir, { recursive: true });
  const log = (s: string): void => { process.stderr.write(`${s}\n`); };
  let recs = await loadRecords(args.dir);
  const done = new Set(recs.map((r) => keyOf(r.model, r.case, r.form)));
  const write = async (r: LabRecord): Promise<void> => {
    await appendFile(join(args.dir, `${slug(r.model)}-${r.form}.jsonl`), `${JSON.stringify(r)}\n`);
    recs = [...recs, r];
    done.add(keyOf(r.model, r.case, r.form));
  };
  const want = (id: string): boolean => args.nur === null || args.nur.has(id);
  const run = async (c: string, form: Form, system: string, user: string, prompt: string, extra: Partial<LabRecord>): Promise<void> => {
    const t0 = Date.now();
    log(`[${new Date().toLocaleTimeString("de-DE")}] ${args.model} ${c} ${form} …`);
    const a = await chat(args, system, user);
    const ms = Date.now() - t0;
    await write({ case: c, form, model: args.model, prompt, raw: a.raw, ms, ...extra, temperature: args.temperature, effort: args.effort, max_tokens: args.maxTokens, finish: a.finish, usage: a.usage, ...(a.reasoningChars !== undefined ? { reasoningChars: a.reasoningChars } : {}) });
    log(`    ${(ms / 1000).toFixed(1)} s, ${a.raw.length} Zeichen, finish=${a.finish ?? "?"}`);
  };

  if (args.phase !== "verfeinern") {
    for (const c of prompts.erzeugen) {
      if (!want(c.id) || done.has(keyOf(args.model, c.id, "svg"))) continue;
      await run(c.id, "svg", sys.erzeugen, c.prompt, c.prompt, {});
    }
  }

  if (args.phase !== "erzeugen") {
    const valid = await validBases(recs);
    const others = [...new Set(recs.map((r) => r.model))].filter((m) => m !== args.model);
    for (const c of prompts.verfeinern) {
      if (!want(c.id)) continue;
      const open = (["svg", "json"] as const).filter((f) => !done.has(keyOf(args.model, c.id, f)));
      if (open.length === 0) continue;
      // Ausgang: eigenes Ergebnis des genannten Erzeugen-Falls; sonst das eines anderen Modells (base: dessen Kennung).
      let input = valid.get(keyOf(args.model, c.basis, "svg")) ?? null;
      let base: string | undefined;
      if (input === null) {
        const have = others.filter((m) => recs.some((r) => r.model === m && r.case === c.basis && r.form === "svg"));
        const usable = have.find((m) => valid.get(keyOf(m, c.basis, "svg")) != null);
        if (usable !== undefined) { input = valid.get(keyOf(usable, c.basis, "svg")) ?? null; base = usable; }
        else if (have.length === 0) { log(`${c.id}: wartet — eigenes ${c.basis} ist ${recs.some((r) => r.model === args.model && r.case === c.basis) ? "ungültig" : "noch nicht gelaufen"}, kein anderes Modell hat ${c.basis} (später mit --phase verfeinern nachholen)`); continue; }
        else { log(`${c.id}: keine Basis — ${c.basis} ist bei allen Modellen ungültig; Fall bleibt offen`); continue; }
      }
      if (input === null) continue;
      for (const f of open) {
        const user = `Ausgangs-SVG:\n\n${input}\n\nAnweisung: ${c.prompt}`;
        await run(c.id, f, f === "svg" ? sys.svg : sys.json, user, c.prompt, { input, ...(base !== undefined ? { base } : {}) });
      }
    }
  }
  log("fertig.");
}

async function status(args: Args): Promise<void> {
  const prompts = await loadPrompts();
  const recs = await loadRecords(args.dir);
  const models = [...new Set(recs.map((r) => r.model))];
  if (models.length === 0) { console.log(`keine Zeilen in ${args.dir}`); return; }
  const cases: Array<[string, Form]> = [...prompts.erzeugen.map((c): [string, Form] => [c.id, "svg"]), ...prompts.verfeinern.flatMap((c): [string, Form][] => [[c.id, "svg"], [c.id, "json"]])];
  for (const m of models) {
    const have = new Set(recs.filter((r) => r.model === m).map((r) => `${r.case}/${r.form}`));
    const missing = cases.filter(([c, f]) => !have.has(`${c}/${f}`)).map(([c, f]) => `${c}/${f}`);
    console.log(`${m}: ${have.size}/${cases.length} Fälle${missing.length ? `; offen: ${missing.join(" ")}` : ""}`);
  }
}

// ---------- Auswerten ----------

interface Row {
  model: string; case: string; kind: "erzeugen" | "verfeinern"; form: Form; ms: number; base?: string;
  rein: boolean; fenced: boolean; parse: boolean; applied: boolean | null; guard: boolean;
  idQuote: number | null; idComplete: boolean; dupIds: number;
  massTreu: boolean | null; messen: PageCheck[] | null;
  entries: number | null; unrequested: number | null; share: number | null; unrequestedList: string[]; done: boolean | null;
  zerlegbar: boolean | null; zerlegbarWarum?: string;
  erfuellt: boolean | null; prueft: PageCheck[];
  notes: string[];
  finish: string | null;
}

async function analysieren(dir: string): Promise<Row[]> {
  const prompts = await loadPrompts();
  const recs = await loadRecords(dir);
  const cc = new Map(prompts.erzeugen.map((c) => [c.id, c]));
  const rc = new Map(prompts.verfeinern.map((c) => [c.id, c]));
  interface Work { rec: LabRecord; row: Row; text: string | null; pair: Pairing | null; refine: RefineCase | null }
  const works: Work[] = [];
  const jobs: PageJob[] = [];
  for (const rec of recs) {
    const create = cc.get(rec.case);
    const refine = rc.get(rec.case) ?? null;
    if (!create && !refine) continue;
    const row: Row = {
      model: rec.model, case: rec.case, kind: create ? "erzeugen" : "verfeinern", form: rec.form, ms: rec.ms, ...(rec.base !== undefined ? { base: rec.base } : {}),
      rein: false, fenced: false, parse: false, applied: null, guard: false, idQuote: null, idComplete: false, dupIds: 0,
      finish: rec.finish ?? null, massTreu: null, messen: null, entries: null, unrequested: null, share: null, unrequestedList: [], done: null, zerlegbar: null, erfuellt: null, prueft: [], notes: [],
    };
    let text: string | null = null;
    if (rec.form === "svg") {
      const ex = extractSvg(rec.raw);
      row.rein = ex.rein; row.fenced = ex.fenced; row.parse = ex.value !== null; text = ex.value;
      if (ex.error) row.notes.push(ex.error);
    } else {
      const ex = extractChanges(rec.raw);
      row.rein = ex.rein; row.fenced = ex.fenced; row.parse = ex.value !== null;
      if (ex.error) row.notes.push(ex.error);
      if (ex.value !== null) {
        if (rec.input === undefined) row.notes.push("Zeile ohne input");
        else {
          const r = applyChanges(rec.input, ex.value);
          row.applied = r.ok;
          if (r.ok) text = r.text; else row.notes.push(`applyChanges: ${r.problems.slice(0, 2).join(" | ")}`);
        }
      }
    }
    works.push({ rec, row, text, pair: null, refine });
    if (text !== null) {
      jobs.push({ key: keyOf(rec.model, rec.case, rec.form), svg: text, ...(create?.messen ? { messen: create.messen } : {}), ...(refine && rec.input ? { base: rec.input, prueft: refine.prueft } : {}) });
    }
  }
  const pageRes = new Map<string, PageResult>((await runPage(jobs)).map((p) => [p.key, p]));

  for (const w of works) {
    const { rec, row, text, refine } = w;
    const p = pageRes.get(keyOf(rec.model, rec.case, rec.form));
    if (text === null || !p) continue;
    if (rec.form === "svg") row.parse = p.parseOk; // wohlgeformt, nicht nur gefunden
    row.guard = p.parseOk && p.guard.ok;
    if (!p.guard.ok) row.notes.push(...p.guard.problems.slice(0, 2));
    if (!p.parseOk && rec.form === "svg") row.notes.push("nicht wohlgeformt");
    if (p.parseOk) {
      const q = idQuote(text);
      row.idQuote = q.quote; row.idComplete = q.complete; row.dupIds = q.dup;
    }
    if (p.messen) {
      row.messen = p.messen;
      row.massTreu = p.messen.every((c) => c.ok);
    }
    if (refine && rec.input !== undefined && row.guard) {
      const pair = pairElements(rec.input, text);
      if (pair === null) {
        // Nicht scanbar (etwa doppelte ids) ist KEIN Ausschluss: in der SVG-Form zählt es als „nicht zerlegbar“.
        const issue = scanElements(text).issues[0];
        const why = issue ? `nicht scanbar: ${issue.message}` : "nicht scanbar";
        row.notes.push(why);
        if (rec.form === "svg") { row.zerlegbar = false; row.zerlegbarWarum = why; }
      } else {
        const j: Unrequested = judgeEntries(pair, refine.erlaubt);
        row.entries = j.total; row.unrequested = j.unrequested; row.share = j.share; row.unrequestedList = j.list; row.done = j.done;
        if (rec.form === "svg") {
          const d = decomposable(rec.input, text, pair);
          row.zerlegbar = d.ok;
          if (!d.ok) row.zerlegbarWarum = d.why;
        }
      }
      row.prueft = p.prueft;
      row.erfuellt = p.prueft.length > 0 && p.prueft.every((c) => c.ok);
    }
  }
  const order = (r: Row): string => `${r.model}|${r.kind === "erzeugen" ? 0 : 1}|${r.form}|${r.case}`;
  return works.map((w) => w.row).sort((a, b) => order(a).localeCompare(order(b), "de", { numeric: true }));
}

const frac = (k: number, n: number): string => `${k}/${n}`;
const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);
const pct = (x: number | null): string => (x === null ? "–" : `${(x * 100).toFixed(0)} %`);
const sec = (x: number | null): string => (x === null ? "–" : `${(x / 1000).toFixed(1)} s`);
const md = (head: string[], rows: string[][]): string => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

/** Spec § 10: drei Grundrisse (E8–E10), Nenner fest, auch wenn die Messung unvollständig ist. */
const GRUNDRISSE = 3;

/** Ein Verfeinern-Ergebnis geht in den Formvergleich ein, wenn es etwas geändert hat UND die Anweisung erfüllt ist. */
const nutzbar = (r: Row): boolean => r.share !== null && (r.entries ?? 0) > 0 && r.erfuellt === true;

interface FormStats { n: number; eintraege: number; unverlangt: number; anteilGepoolt: number | null; anteilMittel: number | null; faelleMitUnverlangtem: number }
function formStats(rs: Row[]): FormStats {
  const eintraege = rs.reduce((x, r) => x + (r.entries ?? 0), 0);
  const unverlangt = rs.reduce((x, r) => x + (r.unrequested ?? 0), 0);
  return { n: rs.length, eintraege, unverlangt, anteilGepoolt: eintraege === 0 ? null : unverlangt / eintraege, anteilMittel: mean(rs.map((r) => r.share as number)), faelleMitUnverlangtem: rs.filter((r) => (r.unrequested ?? 0) > 0).length };
}

interface Summary {
  erzeugen: Array<{ model: string; n: number; parse: number; guard: number; idComplete: number; brauchbar: number; idQuote: number | null; grundrisseMasstreu: number; rein: number; finishLength: number; msMittel: number | null; msSumme: number }>;
  verfeinern: Array<{ model: string; form: Form; n: number; keinErgebnis: number; parse: number; applied: number | null; guard: number; erfuellt: number; nichtsGetan: number; auswertbar: number; anteilMittel: number | null; anteilMittelErfuellt: number | null; faelleMitUnverlangtem: number; unverlangtAbsolut: number; nichtZerlegbar: number | null; zerlegbarAuswertbar: number; finishLength: number; idQuote: number | null; msMittel: number | null }>;
  /** Über alle Modelle, je Form, auf ALLEN auswertbaren Zeilen (roh) und auf den nutzbaren (geändert und erfüllt). */
  form: Array<{ form: Form; n: number; keinErgebnis: number; roh: FormStats; nutzbar: FormStats }>;
  /** Nur die (Modell, Fall)-Paare, in denen BEIDE Formen nutzbar sind. */
  gemeinsam: { paare: number; svg: FormStats; json: FormStats; gewinner: Form | null; gleichstand: boolean };
  hinweise: string[];
}

function zusammenfassen(rows: Row[]): Summary {
  const models = [...new Set(rows.map((r) => r.model))].sort();
  const hinweise: string[] = [];
  const erzeugen: Summary["erzeugen"] = [];
  for (const m of models) {
    const rs = rows.filter((r) => r.model === m && r.kind === "erzeugen");
    if (rs.length === 0) continue;
    erzeugen.push({
      model: m, n: rs.length, parse: rs.filter((r) => r.parse).length, guard: rs.filter((r) => r.guard).length,
      idComplete: rs.filter((r) => r.idComplete).length, brauchbar: rs.filter((r) => r.parse && r.guard && r.idComplete).length,
      idQuote: mean(rs.filter((r) => r.idQuote !== null).map((r) => r.idQuote as number)),
      grundrisseMasstreu: rs.filter((r) => r.massTreu === true).length, rein: rs.filter((r) => r.rein).length, finishLength: rs.filter((r) => r.finish === "length").length,
      msMittel: mean(rs.map((r) => r.ms)), msSumme: rs.reduce((x, r) => x + r.ms, 0),
    });
  }
  const verfeinern: Summary["verfeinern"] = [];
  for (const m of models) for (const form of ["svg", "json"] as const) {
    const rs = rows.filter((r) => r.model === m && r.kind === "verfeinern" && r.form === form);
    if (rs.length === 0) continue;
    const aus = rs.filter((r) => r.share !== null);
    const nutz = rs.filter(nutzbar);
    const zer = rs.filter((r) => r.zerlegbar !== null);
    verfeinern.push({
      model: m, form, n: rs.length, keinErgebnis: rs.filter((r) => !r.guard).length, parse: rs.filter((r) => r.parse).length, applied: form === "json" ? rs.filter((r) => r.applied).length : null,
      guard: rs.filter((r) => r.guard).length, erfuellt: rs.filter((r) => r.erfuellt).length, nichtsGetan: aus.filter((r) => r.entries === 0).length,
      auswertbar: aus.length, anteilMittel: mean(aus.map((r) => r.share as number)), anteilMittelErfuellt: mean(nutz.map((r) => r.share as number)),
      faelleMitUnverlangtem: aus.filter((r) => (r.unrequested ?? 0) > 0).length, unverlangtAbsolut: aus.reduce((x, r) => x + (r.unrequested ?? 0), 0),
      nichtZerlegbar: form === "svg" ? zer.filter((r) => !r.zerlegbar).length : null, zerlegbarAuswertbar: zer.length,
      finishLength: rs.filter((r) => r.finish === "length").length, idQuote: mean(rs.filter((r) => r.idQuote !== null).map((r) => r.idQuote as number)), msMittel: mean(rs.map((r) => r.ms)),
    });
  }
  const form: Summary["form"] = [];
  for (const f of ["svg", "json"] as const) {
    const rs = rows.filter((r) => r.kind === "verfeinern" && r.form === f);
    if (rs.length === 0) continue;
    form.push({ form: f, n: rs.length, keinErgebnis: rs.filter((r) => !r.guard).length, roh: formStats(rs.filter((r) => r.share !== null)), nutzbar: formStats(rs.filter(nutzbar)) });
  }
  // Gemeinsame Menge: (Modell, Fall) mit nutzbarer Antwort in BEIDEN Formen.
  const ref = rows.filter((r) => r.kind === "verfeinern");
  const sv: Row[] = [];
  const js: Row[] = [];
  for (const r of ref.filter((x) => x.form === "svg" && nutzbar(x))) {
    const o = ref.find((x) => x.form === "json" && x.model === r.model && x.case === r.case && nutzbar(x));
    if (o) { sv.push(r); js.push(o); }
  }
  const gs = formStats(sv);
  const gj = formStats(js);
  const gleichstand = gs.anteilGepoolt !== null && gs.anteilGepoolt === gj.anteilGepoolt;
  const gewinner: Form | null = gs.anteilGepoolt === null || gj.anteilGepoolt === null ? null : gj.anteilGepoolt < gs.anteilGepoolt ? "json" : "svg";
  const gemeinsam: Summary["gemeinsam"] = { paare: sv.length, svg: gs, json: gj, gewinner, gleichstand };

  // Hinweise nach Spec § 10 (Zahlen, keine Entscheidung; die trifft der Master bzw. Johannes).
  for (const e of erzeugen) {
    const ok = e.brauchbar >= 8 && e.grundrisseMasstreu >= 2;
    hinweise.push(`${e.model}: brauchbar ${e.brauchbar}/${e.n} (parsebar, bereinigt, ids vollständig), maßtreue Grundrisse ${e.grundrisseMasstreu}/${GRUNDRISSE} — ${ok ? "erfüllt die Brauchbarkeits-Schwelle (8/10 und 2/3)" : "unter der Brauchbarkeits-Schwelle (8/10 und 2/3): Warnung in der Messzeile"}${e.n < 10 ? " (Messung unvollständig)" : ""}`);
    if (e.brauchbar < 6 || e.grundrisseMasstreu === 0) hinweise.push(`${e.model}: unter 6/10 oder kein maßtreuer Grundriss — gilt dies für das GROSSE Modell, geht Spec Nr. 1 mit den Zahlen an Johannes zurück`);
    if (e.finishLength > 0) hinweise.push(`${e.model}: ${e.finishLength} Erzeugen-Antwort(en) mit finish=length (abgeschnitten, vermutlich zu langes Denken oder Schleife)`);
  }
  const sub = (st: FormStats): string => `${pct(st.anteilGepoolt)} (${st.unverlangt}/${st.eintraege} Einträge, Ø je Fall ${pct(st.anteilMittel)}, Fälle mit Unverlangtem ${st.faelleMitUnverlangtem}/${st.n})`;
  for (const f of form) hinweise.push(`${f.form}: ohne brauchbares Ergebnis ${f.keinErgebnis}/${f.n}; roh (alle auswertbaren Zeilen) ${sub(f.roh)}; nur erfüllt und geändert ${sub(f.nutzbar)}`);
  if (gemeinsam.paare === 0) hinweise.push("Antwortform: keine gemeinsame Menge (kein Fall, in dem beide Formen geändert UND erfüllt haben) — keine Wahl möglich");
  else hinweise.push(`Antwortform auf der gemeinsamen Menge (${gemeinsam.paare} Fälle, beide Formen geändert und erfüllt): svg ${sub(gs)}, json ${sub(gj)} → ${gemeinsam.gleichstand ? "Gleichstand: vollständiges SVG" : `weniger Unverlangtes: ${gewinner}`}${gemeinsam.paare < 6 ? " (kleine Menge, mit Vorsicht lesen)" : ""}`);
  return { erzeugen, verfeinern, form, gemeinsam, hinweise };
}

const KOPF = [
  "# svg-lab Auswertung",
  "",
  "- Kommentare (`<!-- … -->`) zählen nicht: sie werden vor dem Paaren, Normalisieren und Vergleichen ausgeblendet („nicht zerlegbar“ ist kein Artefakt von Kommentaren).",
  "- „nicht verlangt“ ist eine je Fall von Hand definierte Heuristik (`scripts/lab/prompts.json`, `erlaubt`); sie kennt die vom Modell gewählten ids nicht.",
  "- Formvergleich nur auf der gemeinsamen Menge: (Modell, Fall) mit einer Antwort in BEIDEN Formen, die etwas geändert hat und die Anweisung erfüllt. Fälle ohne brauchbares Ergebnis stehen je Form in „kein Ergebnis“; doppelte ids in einer SVG-Antwort zählen als „nicht zerlegbar“.",
  "- Grundrisse maßtreu: Nenner fest 3 (E8–E10). `finish=length`: Antwort am Token-Limit abgeschnitten.",
  "",
].join("\n");

function render(rows: Row[], s: Summary): string {
  const out: string[] = [KOPF];
  out.push("## Erzeugen (10 Fälle je Modell, Antwortform vollständiges SVG)", "");
  out.push(md(["Modell", "n", "parsebar", "bereinigt", "ids vollständig", "brauchbar", "id-Quote Ø", `Grundrisse maßtreu (von ${GRUNDRISSE})`, "rein (kein Zaun/Prosa)", "finish=length", "Laufzeit Ø", "Laufzeit Σ"],
    s.erzeugen.map((e) => [e.model, String(e.n), frac(e.parse, e.n), frac(e.guard, e.n), frac(e.idComplete, e.n), frac(e.brauchbar, e.n), pct(e.idQuote), frac(e.grundrisseMasstreu, GRUNDRISSE), frac(e.rein, e.n), String(e.finishLength), sec(e.msMittel), sec(e.msSumme)])), "");
  out.push("## Verfeinern (8 Fälle je Modell und Antwortform)", "");
  out.push(md(["Modell", "Form", "n", "kein Ergebnis", "lesbar", "angewendet", "bereinigt", "erfüllt", "nichts getan", "Anteil nicht verlangt Ø (roh / nur erfüllt)", "unverlangte Einträge Σ", "Fälle mit Unverlangtem", "nicht zerlegbar", "finish=length", "id-Quote Ø", "Laufzeit Ø"],
    s.verfeinern.map((v) => [v.model, v.form, String(v.n), frac(v.keinErgebnis, v.n), frac(v.parse, v.n), v.applied === null ? "–" : frac(v.applied, v.n), frac(v.guard, v.n), frac(v.erfuellt, v.n), String(v.nichtsGetan), `${pct(v.anteilMittel)} / ${pct(v.anteilMittelErfuellt)} (${v.auswertbar} ausw.)`, String(v.unverlangtAbsolut), frac(v.faelleMitUnverlangtem, v.auswertbar), v.nichtZerlegbar === null ? "–" : frac(v.nichtZerlegbar, v.zerlegbarAuswertbar), String(v.finishLength), pct(v.idQuote), sec(v.msMittel)])), "");
  out.push("## Antwortform (über alle Modelle)", "");
  const fr = (st: FormStats): string[] => [String(st.n), String(st.eintraege), String(st.unverlangt), pct(st.anteilGepoolt), pct(st.anteilMittel), frac(st.faelleMitUnverlangtem, st.n)];
  out.push(md(["Menge", "Form", "Fälle", "Einträge", "nicht verlangt", "Anteil gepoolt", "Anteil Ø je Fall", "Fälle mit Unverlangtem"],
    [...s.form.map((x) => ["roh (auswertbar)", x.form, ...fr(x.roh)]), ...s.form.map((x) => ["geändert und erfüllt", x.form, ...fr(x.nutzbar)]), ["GEMEINSAM", "svg", ...fr(s.gemeinsam.svg)], ["GEMEINSAM", "json", ...fr(s.gemeinsam.json)]]), "");
  out.push(md(["Form", "Zeilen", "kein Ergebnis"], s.form.map((x) => [x.form, String(x.n), frac(x.keinErgebnis, x.n)])), "");
  out.push("## Hinweise (Zahlen nach Spec § 10, keine Entscheidung)", "", ...s.hinweise.map((h) => `- ${h}`), "");
  out.push("## Fälle im Einzelnen", "");
  const yn = (b: boolean | null): string => (b === null ? "–" : b ? "ja" : "nein");
  out.push(md(["Modell", "Fall", "Form", "parse", "bereinigt", "ids", "maßtreu/erfüllt", "Einträge (unverlangt, Anteil)", "zerlegbar", "finish", "Notiz"],
    rows.map((r) => [r.model, r.case + (r.base !== undefined ? ` (Basis: ${r.base})` : ""), r.form, yn(r.parse), yn(r.guard), r.idQuote === null ? "–" : `${(r.idQuote * 100).toFixed(0)} %${r.dupIds ? ` (${r.dupIds} doppelt)` : ""}`,
      r.kind === "erzeugen" ? (r.messen ? `${yn(r.massTreu)}${r.massTreu ? "" : `: ${r.messen.filter((c) => !c.ok).map((c) => `${c.art} ${c.detail}`).join("; ")}`}` : "–") : `${yn(r.erfuellt)}${r.erfuellt === false ? `: ${r.prueft.filter((c) => !c.ok).map((c) => `${c.art} ${c.detail}`).join("; ")}` : ""}`,
      r.entries === null ? "–" : `${r.entries} (${r.unrequested}, ${pct(r.share)}${r.unrequestedList.length ? `: ${r.unrequestedList.join(", ")}` : ""})`, yn(r.zerlegbar) + (r.zerlegbarWarum ? ` (${r.zerlegbarWarum})` : ""), r.finish ?? "–", r.notes.join("; ").replace(/\|/g, "\\|")])), "");
  return out.join("\n");
}

async function auswerten(args: Args): Promise<void> {
  const rows = await analysieren(args.dir);
  if (rows.length === 0) { console.error(`keine auswertbaren Zeilen in ${args.dir}`); process.exitCode = 1; return; }
  const s = zusammenfassen(rows);
  console.log(args.json ? JSON.stringify({ hinweis: KOPF, rows, summary: s }, null, 1) : render(rows, s));
}

// ---------- Einstieg ----------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.auswerten) await auswerten(args);
  else if (args.status) await status(args);
  else await lauf(args);
}

main().catch((e: unknown) => {
  process.stderr.write(`svg-lab: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
