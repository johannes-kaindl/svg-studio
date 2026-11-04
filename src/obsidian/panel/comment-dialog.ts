// Der Kommentar-Dialog der Prüfliste: `promptText` des Kits (mehrzeilig, eine leere Eingabe ist keine Antwort) mit den Texten des Plugins. `null` heißt Abbruch.
import type { App } from "obsidian";
import { t } from "../../i18n/strings";
import { promptText } from "../../vendor/kit-obsidian/prompt-text";

export function commentDialog(app: App): (initial: string) => Promise<string | null> {
  return (initial) =>
    promptText(app, {
      title: t("review.commentTitle"),
      message: t("review.commentHint"),
      placeholder: t("review.commentPlaceholder"),
      initial,
      okLabel: t("review.commentOk"),
      cancelLabel: t("review.commentCancel"),
      multiline: true,
      allowEmpty: false,
    });
}
