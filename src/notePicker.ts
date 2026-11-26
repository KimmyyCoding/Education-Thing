// The note picker @recall opens in the search chat: a search bar over all
// your notes. Empty, it lists every note (most recently edited first) to
// scroll through. As you type, it matches note names, and also notes whose
// content is about what you typed, even if the name is different.

import { App, prepareFuzzySearch, SuggestModal, TFile } from "obsidian";
import { matchStrength } from "./core/recall";

export interface NoteChoice {
  file: TFile;
  // "name": the name matched what you typed; "meaning": the content did.
  match: "all" | "name" | "meaning";
  strength?: string; // for meaning matches, e.g. "strong match"
}

export interface NotePickerOptions {
  // Notes closest in meaning to the text, best first (from the note index).
  searchByMeaning: (text: string) => Promise<{ path: string; score: number }[]>;
  attach: (file: TFile) => Promise<void>;
  isAttached: (file: TFile) => boolean;
  onClose: () => void;
}

// Typing pauses this long before searching by meaning, which asks Ollama.
const MEANING_DELAY_MS = 200;
const MEANING_RESULTS = 8;

export class NotePicker extends SuggestModal<NoteChoice> {
  constructor(
    app: App,
    private options: NotePickerOptions,
    initialQuery = "",
  ) {
    super(app);
    this.limit = 1000; // let you scroll through every note
    this.setPlaceholder("Find notes to attach: type a name or roughly what it's about…");
    this.setInstructions([
      { command: "↑↓", purpose: "move" },
      { command: "↵", purpose: "attach" },
      { command: "shift ↵", purpose: "attach and keep picking" },
      { command: "esc", purpose: "done" },
    ]);
    // Shift+Enter: attach without closing (see selectSuggestion below).
    this.scope.register(["Shift"], "Enter", (event) => {
      this.selectActiveSuggestion(event);
      return false;
    });
    this.inputEl.value = initialQuery;
  }

  async getSuggestions(query: string): Promise<NoteChoice[]> {
    const files = this.app.vault.getMarkdownFiles();
    const text = query.trim();
    if (!text) {
      return files.sort((a, b) => b.stat.mtime - a.stat.mtime).map((file) => ({ file, match: "all" }));
    }

    // Name matches are instant.
    const fuzzy = prepareFuzzySearch(text);
    const byName = files
      .map((file) => ({ file, result: fuzzy(file.path.replace(/\.md$/, "")) }))
      .filter((m) => m.result !== null)
      .sort((a, b) => b.result!.score - a.result!.score)
      .map((m): NoteChoice => ({ file: m.file, match: "name" }));

    // Meaning matches need Ollama; wait until you pause typing.
    await sleep(MEANING_DELAY_MS);
    if (this.inputEl.value.trim() !== text) return byName; // you kept typing
    const hits = await this.options.searchByMeaning(text).catch(() => []);
    const named = new Set(byName.map((c) => c.file.path));
    const byMeaning = hits
      .filter((hit) => !named.has(hit.path))
      .map((hit): NoteChoice | null => {
        const file = this.app.vault.getFileByPath(hit.path);
        return file ? { file, match: "meaning", strength: matchStrength(hit.score) } : null;
      })
      .filter((c): c is NoteChoice => c !== null);
    return [...byName, ...byMeaning];
  }

  renderSuggestion(choice: NoteChoice, el: HTMLElement): void {
    el.addClass("curious-picker-item");
    const top = el.createDiv({ cls: "curious-picker-name" });
    top.createSpan({ text: choice.file.basename });
    if (this.options.isAttached(choice.file)) top.createSpan({ cls: "curious-picker-tag", text: "attached" });
    if (choice.match === "meaning") top.createSpan({ cls: "curious-picker-tag", text: `about this · ${choice.strength}` });
    const folder = choice.file.parent?.path;
    if (folder && folder !== "/") el.createDiv({ cls: "curious-picker-path", text: folder });
  }

  // Enter attaches and closes; Shift+Enter attaches and stays open.
  selectSuggestion(choice: NoteChoice, event: MouseEvent | KeyboardEvent): void {
    if (event.shiftKey) {
      // Attach, then redraw so the note shows as "attached".
      this.options.attach(choice.file).then(() => this.inputEl.dispatchEvent(new Event("input")));
    } else {
      super.selectSuggestion(choice, event);
    }
  }

  onChooseSuggestion(choice: NoteChoice): void {
    this.options.attach(choice.file);
  }

  onClose(): void {
    super.onClose();
    this.options.onClose();
  }
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
