// The pop-up Alt+E opens on selected text: say how it should change, see
// Claude's suggestion word by word, then accept it or ask for another go.
// Nothing in the note changes until you accept.
//
//   First:  type an instruction (or 1–4 for a ready-made one), Enter
//   Then:   Enter (empty box) accepts · type feedback + Enter tries again
//           Ctrl+Enter accepts · Esc cancels

import { App, Modal } from "obsidian";
import { diffWords, EditSuggestion, PRESETS } from "./core/editing";

type Stage =
  | { kind: "ask" }
  | { kind: "working" }
  | { kind: "review"; suggestion: EditSuggestion }
  | { kind: "error"; message: string };

export interface EditActions {
  // Ask the model. `previous` is set when refining the last suggestion.
  suggest: (instruction: string, previous?: { text: string; feedback: string }) => Promise<EditSuggestion>;
  accept: (text: string) => void;
}

export class EditModal extends Modal {
  private stage: Stage = { kind: "ask" };
  private instruction = "";
  private lastSuggestion: EditSuggestion | null = null;
  private closed = false; // so a late reply doesn't draw into a closed pop-up

  constructor(
    app: App,
    private original: string,
    private actions: EditActions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Suggest edits");
    this.modalEl.addClass("curious-edit-modal");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("curious-edit");
    const stage = this.stage;

    if (stage.kind === "ask") {
      contentEl.createDiv({ cls: "curious-edit-original", text: this.original });
      const presets = contentEl.createDiv({ cls: "curious-edit-presets" });
      PRESETS.forEach((preset, i) => {
        const button = presets.createEl("button", { text: `${i + 1}  ${preset}` });
        button.addEventListener("click", () => this.run(preset));
      });
      this.input("How should it change? (1–4 picks one above)", (text) => {
        const preset = /^[1-4]$/.test(text) ? PRESETS[Number(text) - 1] : text;
        if (preset) this.run(preset);
      });
      this.help("Enter suggest · Shift+Enter new line · Esc cancel");
      return;
    }

    if (stage.kind === "working") {
      contentEl.createDiv({ cls: "curious-edit-status", text: `Claude is working on: "${this.instruction}"…` });
      return;
    }

    if (stage.kind === "error") {
      contentEl.createDiv({ cls: "curious-edit-status", text: `Couldn't suggest edits: ${stage.message}` });
      this.input("Press Enter to try again, or type a different instruction", (text) => this.run(text || this.instruction));
      return;
    }

    // Review: the original with removed words struck out and new ones highlighted.
    const { suggestion } = stage;
    const unchanged = suggestion.text === this.original;
    const diff = contentEl.createDiv({ cls: "curious-edit-diff" });
    for (const part of diffWords(this.original, suggestion.text)) {
      diff.createSpan({ cls: `curious-edit-${part.kind}`, text: part.text });
    }
    if (suggestion.changes.length > 0) {
      const list = contentEl.createEl("ul", { cls: "curious-edit-changes" });
      for (const change of suggestion.changes) list.createEl("li", { text: change });
    }

    const buttons = contentEl.createDiv({ cls: "curious-edit-buttons" });
    const accept = buttons.createEl("button", { cls: "mod-cta", text: unchanged ? "Nothing to change" : "Accept" });
    accept.disabled = unchanged;
    accept.addEventListener("click", () => this.accept());
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    this.input("Not quite? Say what to change and press Enter. Empty Enter accepts.", (text) => {
      if (text) this.run(this.instruction, { text: suggestion.text, feedback: text });
      else this.accept();
    });
    this.help("Enter accept · type + Enter try again · Ctrl+Enter accept · Esc cancel");
  }

  // A text box where Enter submits and Shift+Enter starts a new line.
  private input(placeholder: string, submit: (text: string) => void): void {
    const box = this.contentEl.createEl("textarea", { cls: "curious-edit-input", attr: { placeholder, rows: "2" } });
    box.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.accept();
      else submit(box.value.trim());
    });
    window.setTimeout(() => box.focus());
  }

  private help(text: string): void {
    this.contentEl.createDiv({ cls: "curious-edit-help", text });
  }

  private async run(instruction: string, previous?: { text: string; feedback: string }): Promise<void> {
    this.instruction = instruction;
    this.stage = { kind: "working" };
    this.render();
    try {
      const suggestion = await this.actions.suggest(instruction, previous);
      this.lastSuggestion = suggestion;
      this.stage = { kind: "review", suggestion };
    } catch (error) {
      console.error("Curious:", error);
      this.stage = { kind: "error", message: String((error as Error)?.message ?? error) };
    }
    if (!this.closed) this.render();
  }

  private accept(): void {
    if (this.stage.kind !== "review" || !this.lastSuggestion) return;
    if (this.lastSuggestion.text === this.original) return;
    this.close();
    this.actions.accept(this.lastSuggestion.text);
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }
}
