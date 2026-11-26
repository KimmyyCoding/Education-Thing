// The pop-up @tag opens: suggested tags for the current note, each with a
// reason. Nothing is added until you confirm.
//   ↑ / ↓  move      Space  tick / untick      Enter  add ticked tags      Esc  cancel

import { App, Modal } from "obsidian";
import { TagSuggestion } from "./core/tagging";

export class TagModal extends Modal {
  private suggestions: TagSuggestion[] = [];
  private ticked: boolean[] = [];
  private active = 0;
  private status: string | null = "Reading the note and your existing tags…";

  constructor(
    app: App,
    private noteName: string,
    private load: () => Promise<TagSuggestion[]>,
    private apply: (tags: string[]) => Promise<void>,
  ) {
    super(app);
    this.scope.register([], "ArrowDown", () => this.move(1));
    this.scope.register([], "ArrowUp", () => this.move(-1));
    this.scope.register([], " ", () => this.toggle(this.active));
    this.scope.register([], "Enter", () => {
      void this.confirm();
      return false;
    });
  }

  async onOpen(): Promise<void> {
    this.setTitle(`Tags for "${this.noteName}"`);
    this.render();
    try {
      this.suggestions = await this.load();
      this.ticked = this.suggestions.map(() => true);
      this.status = this.suggestions.length > 0 ? null : "No new tags to suggest. This note looks well tagged.";
    } catch (error) {
      console.error("Curious:", error);
      this.status = `Couldn't suggest tags: ${(error as Error)?.message ?? error}`;
    }
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("curious-tags");
    if (this.status) {
      contentEl.createDiv({ cls: "curious-tags-status", text: this.status });
      return;
    }

    const list = contentEl.createDiv({ cls: "curious-tags-list" });
    this.suggestions.forEach((suggestion, i) => {
      const row = list.createDiv({ cls: "curious-tags-row" });
      if (i === this.active) row.addClass("is-active");
      const box = row.createEl("input", { attr: { type: "checkbox", tabindex: "-1" } });
      box.checked = this.ticked[i];
      box.addEventListener("click", (event) => {
        event.preventDefault();
        this.toggle(i);
      });
      const text = row.createDiv({ cls: "curious-tags-text" });
      const name = text.createDiv({ cls: "curious-tags-name" });
      name.createSpan({ text: `#${suggestion.tag}` });
      // New tags are flagged so the vault doesn't fill up with one-off labels.
      if (suggestion.isNew) name.createSpan({ cls: "curious-tags-new", text: "new" });
      if (suggestion.reason) text.createDiv({ cls: "curious-tags-reason", text: suggestion.reason });
      row.addEventListener("click", () => {
        this.active = i;
        this.toggle(i);
      });
    });

    contentEl.createDiv({
      cls: "curious-tags-help",
      text: "↑↓ move · Space tick/untick · Enter add ticked tags · Esc cancel",
    });
  }

  private move(step: number): false {
    if (this.suggestions.length > 0) {
      this.active = (this.active + step + this.suggestions.length) % this.suggestions.length;
      this.render();
    }
    return false; // handled: don't also scroll the pop-up
  }

  private toggle(i: number): false {
    if (i < this.ticked.length) {
      this.ticked[i] = !this.ticked[i];
      this.render();
    }
    return false;
  }

  private async confirm(): Promise<void> {
    const tags = this.suggestions.filter((_, i) => this.ticked[i]).map((s) => s.tag);
    this.close();
    if (tags.length > 0) await this.apply(tags);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
