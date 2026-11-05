// Die Vorschau im Panel (Spec § 5.3): das geprüfte SVG als DOM in einem OFFENEN Shadow Root, damit sein `<style>` nicht in Obsidian hineinwirkt und
// Obsidians CSS nicht ins Bild. Anklickbar sind die Elemente mit `id` (Auswahl für die Zahlenfelder, § 7.5).
//
// Sicherheit: eingefügt wird GENAU der Baum, den der Bereiniger geprüft hat (`result.svg`), per `ownerDocument.importNode` des Dokuments, in dem der Host
// steht (Popout-Fenster!), nie der Text per `innerHTML` (Parser-Differenz HTML gegen XML, code-kit 0.45.0). Abgelehnter Text: nichts gezeigt, die Probleme
// gehen zurück. Die Auswahlmarke ist ein Attribut mit zufälligem Namen am Element der Vorschau plus ein `<style>` im Shadow Root, nie eine Änderung am Quelltext.
import { CLICK_COST } from "../../core/render-guard";
import type { SvgProblem, checkSvg } from "../../vendor/kit/svg-guard";
import type { RenderGuard } from "../render-guard";
import { drawingBox, localBox, userBox, type Box } from "./bbox";

export type { Box };

export interface PreviewHandle {
  /** `blocked`: eine Absturzmarke steht für diesen Text, es wurde nichts gezeichnet (`problems` ist dann leer). `costly`: der Kostenwert liegt an oder über der Klickschwelle und der Nutzer hat den Text
   *  noch nicht freigegeben, es wurde nichts gezeichnet; der Wert ist der Kostenwert des Bereinigers. */
  show: (text: string) => { ok: true } | { ok: false; problems: SvgProblem[]; blocked?: true; costly?: number };
  /** Markiert das erste Element mit dieser `id` (`null` oder unbekannt: keine Marke). Meldet nichts an `onSelect`. */
  select: (id: string | null) => void;
  /** Ausdehnung des Elements, `null` = die ganze Zeichnung. Ist das gewählte (geklickte) Element das mit dieser `id`, gilt es, nicht ein anderes mit derselben `id`.
   *  `null` auch, wo der Browser nicht messen kann oder nichts zu messen ist. */
  boxOf: (id: string | null) => Box | null;
  /** Ausdehnung des Elements in seinem EIGENEN Koordinatenraum (vor jedem `transform`): die Mitte für `rotate(a cx cy)` (Zahlenfelder, Spec § 7.5). `null`, wo nichts zu messen ist. */
  localBoxOf: (id: string) => Box | null;
  /** Trägt mehr als ein Element diese `id`? Dann ist die Auswahl über die `id` mehrdeutig (Plan 2, Review-Fokus 5). */
  isAmbiguous: (id: string) => boolean;
  /** Farbe der Vorschaufläche (Inline-Stil am Host); `null` = Obsidians Grund. */
  setBackground: (color: string | null) => void;
  destroy: () => void;
}

export interface PreviewOptions {
  guard: typeof checkSvg;
  /** Ein Klick im Bild: die `id` des nächsten Vorfahren (oder des Elements selbst) mit `id` unter der Wurzel, sonst `null`. */
  onSelect: (id: string | null) => void;
  /** Absturzmarken (Laufzeit-Schutz): die Marke steht vor dem Einsetzen des Baums und fällt, wenn das Bild gezeichnet ist; ohne Wächter wird immer gezeichnet. */
  renderGuard?: RenderGuard;
  /** Kostenwert ab dem die Vorschau erst nach einem Klick zeichnet (nur mit `renderGuard`, der die Freigabe hält); Vorgabe `CLICK_COST`. */
  clickCost?: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const isElement = (n: Node | null): n is Element => n !== null && n.nodeType === 1;

/** Ein Name, den das SVG nicht kennt: die Marke lässt sich damit weder per Klasse noch per Attribut vom SVG fälschen oder abschalten. */
function markerName(): string {
  return `data-m${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPreview(parent: HTMLElement, o: PreviewOptions): PreviewHandle {
  // Der Wrapper im Licht-DOM schließt das SVG ein: `contain: paint` macht ihn zum Block für `position: fixed` und `absolute` und schneidet Zeichnen UND Treffer ab,
  // `position: relative` und `overflow: hidden` stützen das. Der Host selbst reicht nicht: ein `:host { contain: none !important }` im SVG hebt das auf.
  const wrap = parent.createDiv({ cls: "svg-studio-stage-wrap" });
  const host = wrap.createDiv({ cls: "svg-studio-stage" });
  const shadow = host.attachShadow({ mode: "open" });
  const doc = host.ownerDocument;
  const mark = markerName();
  // Nur Theme-Variablen. `all: initial` am Host: Obsidians vererbte Schrift und Farbe (`font`, `color`) wirken nicht ins Bild, es sieht aus wie im `<img>` der Notiz.
  // `outline` zeichnet Chromium an SVG-Elementen nicht, der Schein (`filter`) schon; `!important`, damit ein `* { filter: none }` im SVG die Marke nicht löscht.
  const css = `
:host { all: initial; display: block; overflow: auto; }
svg { display: block; max-width: 100%; height: auto; }
[${mark}] { filter: drop-shadow(0 0 1.5px var(--interactive-accent)) drop-shadow(0 0 1.5px var(--interactive-accent)) !important; }
`;
  // Der Stil kommt als Textknoten, nie als Markup. Ein `style` im SVG-Namensraum wirkt im Shadow Root wie ein HTML-`style` (in Chromium geprüft) und
  // entsteht im Dokument des Hosts (Popout); ein HTML-`style` per `createEl` verbietet die Lint-Regel `no-forbidden-elements`.
  const base = shadow.appendChild(doc.createElementNS(SVG_NS, "style"));
  base.textContent = css;
  let svg: SVGSVGElement | null = null;
  /** Der Wächter der Absturzmarke für den Baum, der gerade hängt; `clear`/`destroy` beenden ihn. */
  let ticket: { abort: () => void } | undefined;
  let marked: Element | null = null;

  const withId = (id: string): SVGGraphicsElement[] => {
    if (svg === null) return [];
    // Vergleich über das Attribut, kein Selektor: eine `id` mit Anführungszeichen oder Klammern darf die Suche nicht brechen.
    return Array.from(svg.querySelectorAll("[id]")).filter((el) => el.getAttribute("id") === id) as SVGGraphicsElement[];
  };

  const clear = (): void => {
    ticket?.abort();
    ticket = undefined;
    marked = null;
    svg?.remove();
    svg = null;
  };

  const markEl = (el: Element | null): void => {
    marked?.removeAttribute(mark);
    marked = el;
    marked?.setAttribute(mark, "");
  };

  const idAt = (target: EventTarget | null): { id: string; el: Element } | null => {
    if (svg === null) return null;
    let n: Node | null = target as Node | null;
    while (n !== null && n !== svg) {
      if (isElement(n) && n.parentNode !== null) {
        const id = n.getAttribute("id");
        if (id !== null && id !== "" && svg.contains(n)) return { id, el: n };
      }
      n = n.parentNode;
    }
    return null;
  };

  const onClick = (ev: Event): void => {
    // Vom Host aus ist `target` auf den Host umgeleitet; den echten Ursprung nennt der Pfad.
    const origin = ev.composedPath()[0] ?? ev.target;
    const hit = idAt(origin);
    // Das GEKLICKTE Element bleibt das gewählte, auch wenn eine `id` doppelt vorkommt (nie neu per `id` suchen).
    markEl(hit === null ? null : hit.el);
    o.onSelect(hit === null ? null : hit.id);
  };
  host.addEventListener("click", onClick);

  return {
    show(text) {
      clear();
      // Marke zuerst: ein blockierter Text läuft nicht einmal durch den Bereiniger, und die Marke steht schon vor ihm (er kann selbst hängen).
      if (o.renderGuard?.isMarked(text) === true) return { ok: false, problems: [], blocked: true };
      const t = o.renderGuard?.begin(text, doc.defaultView ?? window);
      const r = o.guard(text);
      if (!r.ok) {
        t?.abort();
        return { ok: false, problems: r.problems };
      }
      // Nahe der Kostengrenze erst nach einem Klick, wie im Block: die Freigabe (je Text und Sitzung) liegt im Wächter und gilt für Block, Vorschau und Vergleich gemeinsam.
      if (o.renderGuard !== undefined && !o.renderGuard.released(text) && r.cost >= (o.clickCost ?? CLICK_COST)) {
        t?.abort();
        return { ok: false, problems: [], costly: r.cost };
      }
      svg = doc.importNode(r.svg, true);
      // Ein Element, das schon unseren Markennamen trägt, stammt nicht von uns (der Name ist zufällig, also nur ein Zufallstreffer): weg damit.
      for (const el of Array.from(svg.querySelectorAll(`[${mark}]`))) el.removeAttribute(mark);
      ticket = t;
      shadow.appendChild(svg);
      t?.settle();
      return { ok: true };
    },
    select(id) {
      markEl(id === null ? null : (withId(id)[0] ?? null));
    },
    boxOf(id) {
      if (svg === null) return null;
      if (id === null) return drawingBox(svg);
      const el = marked !== null && marked.getAttribute("id") === id ? (marked as SVGGraphicsElement) : (withId(id)[0] ?? null);
      return el === null ? null : userBox(svg, el);
    },
    localBoxOf(id) {
      const el = marked !== null && marked.getAttribute("id") === id ? (marked as SVGGraphicsElement) : (withId(id)[0] ?? null);
      return el === null ? null : localBox(el);
    },
    isAmbiguous: (id) => withId(id).length > 1,
    setBackground(color) {
      if (color === null) host.style.removeProperty("background-color");
      else host.style.setProperty("background-color", color);
    },
    destroy() {
      host.removeEventListener("click", onClick);
      clear();
      wrap.remove();
    },
  };
}
