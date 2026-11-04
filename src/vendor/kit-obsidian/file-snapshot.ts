// vendored from obsidian-kit@0.80.0, src/obsidian/file-snapshot.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Herkunft: obsidian-transmute `src/obsidian/snapshot-io.ts` (`snapshotRoot`, `ensureDir`, `writeSnapshot`, `rotateSnapshots`) und `src/core/vault/snapshot.ts`
// (`snapshotDirName`), auf eine Einzeldatei zugeschnitten; REGISTRY „Rückholbarkeit für Schreibvorgänge“ führte transmute als Kit-Kandidaten, svg-studio ist
// der zweite Träger (K15, bedingt durch die Messung A4 vom 2026-11-04: Obsidians Dateiwiederherstellung erfasst nur Markdown, `.svg` und andere Dateien nicht).
// Was transmute darüber hinaus trägt (Manifest mit Regel und Hashes, Rückholentscheidung) bleibt dort: es gehört zu einem Lauf über viele Dateien, nicht zum
// Schnappschuss einer Datei. Die Staffelung (Großvater-Vater-Sohn) ist dagegen Pflicht (PROF-OBS-15) und steckt hier.
//
// Ein Schnappschuss VOR dem Überschreiben einer Datei, die Obsidian selbst nicht sichert. Die Kopie liegt unter
// `<configDir>/plugins/<pluginId>/snapshots/<Stempel>/<Vault-Pfad>`; der Stempel ist UTC mit Millisekunden (`stampedName` aus code-kit `rotation`), sortiert
// also zeitlich, und `selectGfsRetention` (code-kit `rotation`, PROF-OBS-15) staffelt: je Tag/Woche/Monat bleibt der älteste, dazu die neuesten des Tages
// (Vorgabe `DEFAULT_GFS_POLICY`: 6 heute · 7 Tage · 4 Wochen · 6 Monate; `policy` ersetzt sie). Gedacht als `beforeWrite` für `acceptPanel`: scheitert der Schnappschuss, wird nichts geschrieben.
//
// - **`configDir`, nie `.obsidian`:** der Ordner ist konfigurierbar (`hardcoded-config-path`).
// - **Vor dem Rotieren schreiben:** erst die neue Kopie, dann das Löschen der überzähligen; ein Schreibfehler rotiert nicht, der letzte gute Schnappschuss bleibt.
//   Ein Fehler beim Löschen macht den neuen Schnappschuss nicht ungültig (er liegt da); der Aufrufer darf schreiben. Der eben geschriebene Ordner wird nie
//   wegrotiert (`protect`), auch dann nicht, wenn die Policy ihn nicht hält (Opus-Review, belegt). Geht die Uhr zurück, liegen die übrigen in der Zukunft und
//   bleiben (`selectGfsRetention`: unbekannt heißt behalten).
// - **Gestaffelt wird über ALLE Schnappschüsse des Plugins, nicht je Datei:** mehrere abwechselnd überschriebene Dateien teilen sich die Plätze (der älteste
//   des Tages ist der älteste über alle Dateien). Eine Staffelung je Datei kennt der Baustein nicht (offene Task im Kit-Cockpit).
// - **Kalender:** Vorgabe `localCalendar` (der Tag des Nutzers); `calendar` ersetzt ihn (Tests: `utcCalendar`, sonst hängt das Ergebnis von der Zeitzone ab).
// - **Nie überschreiben:** zwei Schnappschüsse derselben Datei im selben Moment bekommen verschiedene Stempel (eine Millisekunde weiter).
// - **Unsichere Eingaben vorher abgelehnt:** eine Plugin-ID, die kein sicherer Ordnername ist (`isValidPluginId`), und ein Pfad mit `..`, absolut oder mit `\`.
// - **Ordner ohne Stempel bleiben:** was die Rotation nicht lesen kann, löscht sie nicht (unbekannt heißt behalten).

import type { App } from "obsidian";
import { isValidPluginId } from "../kit/plugin-id";
import { type GfsCalendar, type GfsPolicy, selectGfsRetention, stampedName, timeFromStampedName } from "../kit/rotation";

export type SnapshotResult = { ok: true; snapshotPath: string } | { ok: false; message: string };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Ein Vault-Pfad, der sicher unter den Schnappschuss-Ordner passt: relativ, mit `/`, ohne leere, `.`- oder `..`-Teile. */
function isSafeVaultPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

async function ensureDir(app: App, path: string): Promise<void> {
  if (await app.vault.adapter.exists(path)) return;
  const slash = path.lastIndexOf("/");
  if (slash > 0) await ensureDir(app, path.slice(0, slash));
  await app.vault.adapter.mkdir(path);
}

/** Sichert `content` (den Stand VOR dem Überschreiben) von `path` und staffelt die Schnappschüsse nach Großvater-Vater-Sohn (`policy`, Vorgabe 6 · 7 · 4 · 6). Wirft nie. */
export async function snapshotFile(
  app: App,
  o: { pluginId: string; path: string; content: string; policy?: GfsPolicy; calendar?: GfsCalendar; now?: Date },
): Promise<SnapshotResult> {
  if (!isValidPluginId(o.pluginId)) return { ok: false, message: `not a safe plugin id: ${JSON.stringify(o.pluginId)}` };
  if (!isSafeVaultPath(o.path)) return { ok: false, message: `not a safe vault path: ${JSON.stringify(o.path)}` };
  const root = `${app.vault.configDir}/plugins/${o.pluginId}/snapshots`;
  let snapshotPath = "";
  let ownName = "";
  let ownTime = 0;
  try {
    let time = (o.now ?? new Date()).getTime();
    ownName = stampedName(time);
    let dir = `${root}/${ownName}`;
    snapshotPath = `${dir}/${o.path}`;
    // Derselbe Moment, dieselbe Datei: eine Millisekunde weiter, nie überschreiben.
    for (let tries = 0; tries < 1000 && (await app.vault.adapter.exists(snapshotPath)); tries++) {
      time += 1;
      ownName = stampedName(time);
      dir = `${root}/${ownName}`;
      snapshotPath = `${dir}/${o.path}`;
    }
    await ensureDir(app, snapshotPath.slice(0, snapshotPath.lastIndexOf("/")));
    await app.vault.adapter.write(snapshotPath, o.content);
    ownTime = time;
  } catch (error) {
    return { ok: false, message: `could not write the snapshot${snapshotPath ? ` ${snapshotPath}` : ""}: ${errorText(error)}` };
  }
  try {
    const listing = await app.vault.adapter.list(root);
    // Alle gestempelten Ordner (auch der eigene) gehen in die Staffelung, `now` ist der eigene Stempel; der eigene Ordner ist zusätzlich geschützt, damit
    // `ok: true` nie einen Schnappschuss meldet, den dieselbe Rotation sofort löscht (leere Policy). Ordner ohne lesbaren Stempel zählen nicht.
    const entries = listing.folders.flatMap((f) => {
      const name = f.slice(root.length + 1);
      const time = timeFromStampedName(name);
      return time === null ? [] : [{ name, time }];
    });
    const { drop } = selectGfsRetention(entries, ownTime, { policy: o.policy, calendar: o.calendar, protect: [ownName] });
    for (const name of drop) await app.vault.adapter.rmdir(`${root}/${name}`, true);
  } catch {
    // Der Schnappschuss liegt da; überzählige Ordner räumt der nächste Lauf.
  }
  return { ok: true, snapshotPath };
}
