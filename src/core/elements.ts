// Elementliste mit Byte-Offsets. Pure.
// Der Scanner ist KEIN Prüfer (das ist `svg-guard`): er meldet Struktur und Offsets in den
// ORIGINALTEXT, damit spätere Änderungen nur die betroffenen Spannen umschreiben und alle
// übrigen Bytes gleich bleiben. Ein einziger linearer Durchlauf, kein Regex über den Gesamttext;
// Regex gibt es nur für kurze, begrenzte Zeichenfolgen (eine Entity, ein Zahlenwort).

export interface AttrSpan {
  /** Name wie im Quelltext, mit Präfix. */
  name: string;
  /** Wert ohne Anführungszeichen, unverändert. */
  raw: string;
  /** Wert wie ein XML-Parser ihn sieht: wörtliches CRLF, CR, LF und TAB im Rohwert werden je EIN Leerzeichen (Attributwert-Normalisierung),
   *  danach werden Entities aufgelöst (`&#10;` bleibt ein Zeilenumbruch). */
  value: string;
  quote: '"' | "'";
  /** Offset des ersten Zeichens des Attributnamens. */
  start: number;
  /** Offset nach dem öffnenden Anführungszeichen. */
  valueStart: number;
  /** Offset des schließenden Anführungszeichens. */
  valueEnd: number;
}

export interface SvgElement {
  /** `id`, sonst fester Schlüssel (`#wurzel`, `#style-1`, `#title`, `#desc`), sonst `@<laufende Nummer>`. */
  key: string;
  id: string | null;
  /** Lokaler Name, klein. */
  tag: string;
  parentKey: string | null;
  /** Offset von `<`. */
  start: number;
  /** Offset nach dem `>` des Start-Tags. */
  openEnd: number;
  /** Offset von `</`; bei selbstschließenden (und nie geschlossenen) Elementen `=== openEnd` bzw. Fundstelle der Schließung. */
  closeStart: number;
  /** Offset nach dem letzten `>`. */
  end: number;
  selfClosing: boolean;
  attrs: AttrSpan[];
}

export interface ScanIssue {
  offset: number;
  message: string;
  /** `duplicate-id`: nur eine doppelte id (Spec § 6.2: wird in Reihenfolge gepaart, blockiert nichts); alles andere ist `syntax`. */
  kind: "syntax" | "duplicate-id";
}

const isWs = (c: number): boolean => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;

const NUMERIC_ENTITY = /^#(?:x([0-9a-f]{1,6})|([0-9]{1,7}))$/i;
const NAMED_ENTITIES = new Map<string, string>([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"]]);
const ENTITY_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
/** Längste benannte Entity, bei der noch nach dem `;` gesucht wird (für die Prüfung auf nicht deklarierte Namen). */
const MAX_NAMED_ENTITY_LEN = 40;
/** Längste Entity-Schreibweise, die wir auflösen (`&#x10FFFF;` = 8 Zeichen zwischen & und ;). */
const MAX_ENTITY_LEN = 9;

const LITERAL_BREAK = /\r\n|[\r\n\t]/g;

/** XML-Attributwert-Normalisierung vor dem Auflösen der Entities: wörtliche Umbrüche und Tabs werden je ein Leerzeichen. */
function normalizeLiteralBreaks(raw: string): string {
  return raw.replace(LITERAL_BREAK, " ");
}

/** Löst &amp; &lt; &gt; &quot; &apos; &#n; &#xn; auf; alles andere bleibt wörtlich stehen. */
function decodeEntities(raw: string): string {
  let amp = raw.indexOf("&");
  if (amp < 0) return raw;
  let out = "";
  let last = 0;
  while (amp >= 0) {
    // Das ";" nur in den nächsten Zeichen suchen: ein unbegrenztes indexOf wäre bei vielen "&" quadratisch.
    let semi = -1;
    const limit = Math.min(raw.length, amp + 2 + MAX_ENTITY_LEN);
    for (let j = amp + 1; j < limit; j++) {
      if (raw.charCodeAt(j) === 0x3b) {
        semi = j;
        break;
      }
    }
    let decoded: string | null = null;
    if (semi > 0) {
      const name = raw.slice(amp + 1, semi);
      decoded = NAMED_ENTITIES.get(name) ?? null;
      if (decoded === null) {
        const m = NUMERIC_ENTITY.exec(name);
        if (m) {
          const cp = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2], 10);
          if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) decoded = String.fromCodePoint(cp);
        }
      }
    }
    if (decoded !== null) {
      out += raw.slice(last, amp) + decoded;
      last = semi + 1;
      amp = raw.indexOf("&", last);
    } else {
      amp = raw.indexOf("&", amp + 1);
    }
  }
  return out + raw.slice(last);
}

/** Überspringt `<!DOCTYPE …>` samt innerer Untermenge `[ … ]` und Anführungszeichen; liefert den Offset nach `>` oder -1. */
function skipDoctype(text: string, from: number): number {
  let depth = 0;
  let quote = 0;
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quote !== 0) {
      if (c === quote) quote = 0;
    } else if (c === 0x22 || c === 0x27) quote = c;
    else if (c === 0x5b) depth++;
    else if (c === 0x5d) depth = Math.max(0, depth - 1);
    else if (c === 0x3e && depth === 0) return i + 1;
  }
  return -1;
}

interface Open {
  el: SvgElement;
  rawName: string;
}

/** Ergebnis eines Start-Tag-Versuchs: das Element ohne Schlüssel oder ein Abbruch mit Wiederaufsetzpunkt. */
type TagRead =
  | { ok: true; rawName: string; attrs: AttrSpan[]; openEnd: number; selfClosing: boolean }
  | { ok: false; resume: number };

export function scanElements(text: string): {
  elements: SvgElement[];
  issues: ScanIssue[];
  /** Spannen der Kommentare `<!-- … -->` (nicht die in CDATA, Attributen oder Verarbeitungsanweisungen). */
  comments: Array<{ start: number; end: number }>;
} {
  const elements: SvgElement[] = [];
  const issues: ScanIssue[] = [];
  const comments: Array<{ start: number; end: number }> = [];
  const stack: Open[] = [];
  // Zählt offene Elemente je Namen: ein Schließ-Tag ohne offenes Gegenstück kostet O(1) statt eines Stapelabstiegs.
  const openCount = new Map<string, number>();
  const ids = new Set<string>();
  const n = text.length;
  let styleCount = 0;
  let fallbackCount = 0;
  let hasRoot = false;
  let hasTitle = false;
  let hasDesc = false;

  const issue = (offset: number, message: string, kind: ScanIssue["kind"] = "syntax"): void => {
    issues.push({ offset, message, kind });
  };
  // Eine DOCTYPE-Untermenge mit `<!ENTITY` deklariert eigene Namen; wir lösen sie nicht auf, prüfen dann aber auch nicht.
  let customEntities = false;
  // Nächstes "&" ab `from`, ohne bei jedem Aufruf bis ans Textende zu suchen (sonst quadratisch bei vielen Tags ohne "&").
  let ampFrom = 0;
  let ampAt = text.indexOf("&");
  const nextAmp = (from: number): number => {
    if (from < ampFrom || (ampAt >= 0 && ampAt < from)) {
      ampFrom = from;
      ampAt = text.indexOf("&", from);
    }
    return ampAt;
  };
  /** Meldet `&name;` mit einem Namen außerhalb der fünf XML-Entities (z. B. `&nbsp;`): kein wohlgeformtes XML ohne DTD. */
  const checkEntities = (from: number, to: number): void => {
    if (customEntities) return;
    let amp = nextAmp(from);
    while (amp >= 0 && amp < to) {
      const limit = Math.min(to, amp + 2 + MAX_NAMED_ENTITY_LEN);
      let semi = -1;
      for (let j = amp + 1; j < limit; j++) {
        if (text.charCodeAt(j) === 0x3b) {
          semi = j;
          break;
        }
      }
      if (semi > 0) {
        const name = text.slice(amp + 1, semi);
        if (ENTITY_NAME.test(name) && !NAMED_ENTITIES.has(name)) issue(amp, `Entity &${name}; ist nicht deklariert`);
      }
      amp = nextAmp(amp + 1);
    }
  };

  const readStartTag = (lt: number): TagRead => {
    let i = lt + 1;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (isWs(c) || c === 0x2f || c === 0x3e || c === 0x3c) break;
      i++;
    }
    const rawName = text.slice(lt + 1, i);
    if (rawName === "") {
      issue(lt, "Tag ohne Namen");
      return { ok: false, resume: lt + 1 };
    }
    if (!/^[A-Za-z_:]/.test(rawName)) issue(lt, `Tag-Name <${rawName}> beginnt nicht mit Buchstabe, "_" oder ":"`);
    const attrs: AttrSpan[] = [];
    const seen = new Set<string>();
    while (true) {
      while (i < n && isWs(text.charCodeAt(i))) i++;
      if (i >= n) {
        issue(lt, `Start-Tag <${rawName}> nicht abgeschlossen`);
        return { ok: false, resume: n };
      }
      const c = text.charCodeAt(i);
      if (c === 0x3e) return { ok: true, rawName, attrs, openEnd: i + 1, selfClosing: false };
      if (c === 0x2f) {
        if (text.charCodeAt(i + 1) === 0x3e) return { ok: true, rawName, attrs, openEnd: i + 2, selfClosing: true };
        issue(i, "Einzelner Schrägstrich im Start-Tag");
        i++;
        continue;
      }
      if (c === 0x3c) {
        issue(lt, `Start-Tag <${rawName}> vor dem nächsten "<" nicht abgeschlossen`);
        return { ok: false, resume: i };
      }
      if (c === 0x3d) {
        issue(i, "Attribut ohne Namen");
        i++;
        continue;
      }
      const nameStart = i;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (isWs(d) || d === 0x3d || d === 0x2f || d === 0x3e || d === 0x3c) break;
        i++;
      }
      const name = text.slice(nameStart, i);
      let k = i;
      while (k < n && isWs(text.charCodeAt(k))) k++;
      if (text.charCodeAt(k) !== 0x3d) {
        issue(nameStart, `Attribut ${name} ohne Wert`);
        continue;
      }
      k++;
      while (k < n && isWs(text.charCodeAt(k))) k++;
      const q = text.charCodeAt(k);
      if (q === 0x22 || q === 0x27) {
        const quote = q === 0x22 ? '"' : "'";
        const close = text.indexOf(quote, k + 1);
        if (close < 0) {
          issue(k, `Anführungszeichen bei ${name} nicht geschlossen`);
          return { ok: false, resume: n };
        }
        const raw = text.slice(k + 1, close);
        if (seen.has(name)) issue(nameStart, `Attribut ${name} doppelt im Tag <${rawName}>`);
        if (raw.includes("<")) issue(k + 1, `Attribut ${name}: rohes "<" im Wert`);
        checkEntities(k + 1, close);
        seen.add(name);
        attrs.push({ name, raw, value: decodeEntities(normalizeLiteralBreaks(raw)), quote, start: nameStart, valueStart: k + 1, valueEnd: close });
        i = close + 1;
        const after = text.charCodeAt(i);
        if (i < n && !isWs(after) && after !== 0x2f && after !== 0x3e) issue(i, `Attribut ${name}: kein Leerraum vor dem nächsten Attribut`);
      } else {
        issue(k, `Attribut ${name} ohne Anführungszeichen`);
        while (k < n) {
          const d = text.charCodeAt(k);
          if (isWs(d) || d === 0x3e || d === 0x3c) break;
          k++;
        }
        i = k;
      }
    }
  };

  const decOpen = (rawName: string): void => {
    openCount.set(rawName, (openCount.get(rawName) ?? 1) - 1);
  };

  let pos = 0;
  while (pos < n) {
    const lt = text.indexOf("<", pos);
    checkEntities(pos, lt < 0 ? n : lt);
    if (lt < 0) break;

    if (text.startsWith("<!--", lt)) {
      const e = text.indexOf("-->", lt + 4);
      if (e < 0) {
        issue(lt, "Kommentar nicht geschlossen");
        break;
      }
      comments.push({ start: lt, end: e + 3 });
      pos = e + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const e = text.indexOf("]]>", lt + 9);
      if (e < 0) {
        issue(lt, "CDATA nicht geschlossen");
        break;
      }
      pos = e + 3;
      continue;
    }
    if (text.startsWith("<?", lt)) {
      const e = text.indexOf("?>", lt + 2);
      if (e < 0) {
        issue(lt, "Verarbeitungsanweisung nicht geschlossen");
        break;
      }
      pos = e + 2;
      continue;
    }
    if (text.startsWith("<!", lt)) {
      const e = text.startsWith("<!DOCTYPE", lt) ? skipDoctype(text, lt + 9) : text.indexOf(">", lt + 2) + 1;
      if (e > 0 && text.startsWith("<!DOCTYPE", lt) && text.slice(lt, e).includes("<!ENTITY")) customEntities = true;
      if (e <= 0) {
        issue(lt, "Deklaration nicht geschlossen");
        break;
      }
      pos = e;
      continue;
    }

    if (text.charCodeAt(lt + 1) === 0x2f) {
      const gt = text.indexOf(">", lt + 2);
      if (gt < 0) {
        issue(lt, "Schließ-Tag nicht abgeschlossen");
        break;
      }
      let nameEnd = lt + 2;
      while (nameEnd < gt && !isWs(text.charCodeAt(nameEnd))) nameEnd++;
      const rawName = text.slice(lt + 2, nameEnd);
      pos = gt + 1;
      if ((openCount.get(rawName) ?? 0) === 0) {
        issue(lt, `Schließ-Tag </${rawName}> ohne passendes Start-Tag`);
        continue;
      }
      while (stack.length > 0) {
        const top = stack.pop()!;
        decOpen(top.rawName);
        if (top.rawName === rawName) {
          top.el.closeStart = lt;
          top.el.end = gt + 1;
          break;
        }
        // Ein Element dazwischen blieb offen: es endet dort, wo das Schließ-Tag des Elternelements beginnt.
        issue(top.el.start, `<${top.rawName}> nicht geschlossen`);
        top.el.closeStart = lt;
        top.el.end = lt;
      }
      continue;
    }

    const tag = readStartTag(lt);
    if (!tag.ok) {
      pos = tag.resume;
      continue;
    }
    pos = tag.openEnd;

    const local = tag.rawName.slice(tag.rawName.lastIndexOf(":") + 1).toLowerCase();
    const idAttr = tag.attrs.find((a) => a.name === "id");
    const id = idAttr !== undefined && idAttr.value !== "" ? idAttr.value : null;
    const parent = stack.length > 0 ? stack[stack.length - 1].el : null;

    let fixed: string | null = null;
    if (parent === null && !hasRoot) {
      fixed = "#wurzel";
      hasRoot = true;
    } else if (local === "style") {
      styleCount++;
      fixed = `#style-${styleCount}`;
    } else if (local === "title" && stack.length === 1 && !hasTitle) {
      fixed = "#title";
      hasTitle = true;
    } else if (local === "desc" && stack.length === 1 && !hasDesc) {
      fixed = "#desc";
      hasDesc = true;
    }
    // Ein fester Schlüssel schlägt die id (Spec § 5.1); die id bleibt im Feld `id`.
    const key = fixed ?? id ?? `@${++fallbackCount}`;
    if (id !== null) {
      if (ids.has(id)) issue(lt, `id "${id}" doppelt`, "duplicate-id");
      ids.add(id);
    }

    const el: SvgElement = {
      key,
      id,
      tag: local,
      parentKey: parent === null ? null : parent.key,
      start: lt,
      openEnd: tag.openEnd,
      closeStart: tag.openEnd,
      end: tag.openEnd,
      selfClosing: tag.selfClosing,
      attrs: tag.attrs,
    };
    elements.push(el);
    if (!tag.selfClosing) {
      stack.push({ el, rawName: tag.rawName });
      openCount.set(tag.rawName, (openCount.get(tag.rawName) ?? 0) + 1);
    }
  }

  for (const open of stack) {
    issue(open.el.start, `<${open.rawName}> nicht geschlossen`);
    open.el.closeStart = n;
    open.el.end = n;
  }
  return { elements, issues, comments };
}

/** Dekodierter Wert des ersten Attributs mit diesem Namen (mit Präfix), sonst `null`. */
export function attr(el: SvgElement, name: string): string | null {
  for (const a of el.attrs) if (a.name === name) return a.value;
  return null;
}
