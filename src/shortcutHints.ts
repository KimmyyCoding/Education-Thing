// Small hints, in the top-right corner of the note, that suggest a shortcut
// when it would help right now, like "Alt+O open beside" when the cursor is on a link. Each hint stops showing
// once you've used its shortcut a few times, so they don't become clutter.
// Settings → Curious can turn them off, or bring them back.

import { EditorState } from "@codemirror/state";
import { Panel, showPanel } from "@codemirror/view";
import { App } from "obsidian";
import { findLinks } from "./core/urls";

// After this many uses, a shortcut counts as learned and its hint goes.
export const LEARNED_AFTER = 3;

export interface HintActions {
  enabled: () => boolean;
  isLearned: (commandId: string) => boolean;
  keyFor: (commandId: string) => string | null; // e.g. "Alt+O"
}

interface Hint {
  commandId: string;
  what: string;
}

// The hints that fit where the cursor is.
export function hintsFor(state: EditorState): { pos: number; hints: Hint[] } | null {
  const { from, to, empty } = state.selection.main;
  const line = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);
  const text = state.doc.sliceString(line.from, endLine.to);
  const links = findLinks(text).map((l) => ({ from: l.from + line.from, to: l.to + line.from }));
  // With just a cursor, only when it's inside a link, not merely touching
  // its end, so typing right after a link doesn't keep showing it.
  const onLink = empty ? links.some((l) => from > l.from && from < l.to) : links.some((l) => from <= l.to && to >= l.from);

  const hints: Hint[] = [];
  if (onLink) hints.push({ commandId: "open-link-beside", what: "open beside" });
  if (!empty && state.sliceDoc(from, to).trim()) {
    hints.push({ commandId: "suggest-edits", what: "suggest edits" });
    hints.push({ commandId: "attach-to-search", what: "ask in search" });
  }
  return hints.length > 0 ? { pos: empty ? from : to, hints } : null;
}

// A small label pinned to the top-right corner of the note, so hints never
// sit on what you're writing, and showing one never pushes the text down
// (which would move it under your mouse while selecting). It
// is always there (hidden when there's nothing to suggest) and only its
// text changes as the cursor moves.
export function createShortcutHints(actions: HintActions) {
  const fill = (dom: HTMLElement, state: EditorState) => {
    const found = actions.enabled() ? hintsFor(state) : null;
    const shown = (found?.hints ?? [])
      .filter((hint) => !actions.isLearned(hint.commandId))
      .map((hint) => ({ ...hint, key: actions.keyFor(hint.commandId) }))
      .filter((hint) => hint.key); // no key set: nothing to suggest
    dom.empty();
    dom.toggleClass("is-empty", shown.length === 0);
    shown.forEach((hint, i) => {
      if (i > 0) dom.createSpan({ cls: "curious-hint-sep", text: "·" });
      dom.createEl("kbd", { text: hint.key! });
      dom.createSpan({ text: ` ${hint.what}` });
    });
  };

  return showPanel.of((view): Panel => {
    // The panel itself takes no height; the label floats inside it.
    const bar = document.createElement("div");
    bar.className = "curious-hint-bar";
    const dom = bar.createDiv({ cls: "curious-hint" });
    fill(dom, view.state);
    return {
      dom: bar,
      top: true,
      update: (update) => {
        if (update.docChanged || update.selectionSet) fill(dom, update.state);
      },
    };
  });
}

// The key a Curious command is bound to, as shown in Settings → Hotkeys:
// your own choice if you changed it, otherwise the default. Uses Obsidian's
// hotkey manager, which isn't in its public type definitions, so it's
// careful in case that changes.
export function hotkeyText(app: App, commandId: string): string | null {
  type Hotkey = { modifiers: string[]; key: string };
  const manager = (app as unknown as {
    hotkeyManager?: { getHotkeys?(id: string): Hotkey[] | undefined; getDefaultHotkeys?(id: string): Hotkey[] | undefined };
  }).hotkeyManager;
  const id = `curious:${commandId}`;
  try {
    const keys = manager?.getHotkeys?.(id) ?? manager?.getDefaultHotkeys?.(id) ?? [];
    const first = keys[0];
    if (!first) return null;
    const mods = first.modifiers.map((m) => (m === "Mod" ? "Ctrl" : m));
    return [...mods, first.key.length === 1 ? first.key.toUpperCase() : first.key].join("+");
  } catch {
    return null;
  }
}

