// The side panel @search answers appear in, so you can read on the right
// while writing your own notes on the left. Holds a short conversation: the
// first question, then any follow-ups. Each question + answer is a "chunk";
// you can step between chunks, and the selected one is shown open.

import { ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import { Attachment, SearchResult, SearchTurn } from "./core/search";
import { splitRecall } from "./core/commands";
import { wireLinks } from "./links";
import { renderSwitcher, SwitcherActions } from "./paneSwitcher";

export const SEARCH_VIEW = "curious-search";

export interface SearchState {
  turns: SearchTurn[]; // answered questions, oldest first
  pending: string | null; // question being answered right now
  error: string | null;
  sourcePath: string; // the note the search came from
  attachments: Attachment[]; // waiting to be sent with the next question
}

export interface SearchPanelActions {
  close: () => void; // × button
  followUp: (question: string) => void;
  removeAttachment: (index: number) => void;
  pickNotes: (initialQuery: string) => void; // open the note picker
  commandPrefix: () => string; // "@", unless changed in settings
  backToNote: () => void; // Esc in the follow-up box
  switcher: SwitcherActions; // the Chat · Web switch at the top
}

export class SearchPanel extends ItemView {
  private state: SearchState | null = null;
  private input: HTMLInputElement | null = null;
  private focusInputAfterRender = false;
  private selected: number | null = null; // chunk shown open; null = the latest
  private turnCount = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private actions: SearchPanelActions,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return SEARCH_VIEW;
  }

  getDisplayText(): string {
    return "Curious search";
  }

  getIcon(): string {
    return "globe";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  show(state: SearchState): void {
    // A new answer arrived: jump to it.
    if (state.turns.length !== this.turnCount) this.selected = null;
    this.turnCount = state.turns.length;
    this.state = state;
    this.render();
  }

  // Jump to the follow-up box (from the keyboard), once there is one.
  focusInput(): void {
    if (this.input) this.input.focus();
    else this.focusInputAfterRender = true;
  }

  // Step to the previous (-1) or next (+1) chunk.
  move(step: number): void {
    const count = this.state?.turns.length ?? 0;
    if (count === 0) return;
    const current = this.selected ?? count - 1;
    this.selected = Math.max(0, Math.min(count - 1, current + step));
    this.render();
  }

  private render(): void {
    // Re-rendering replaces the follow-up box; keep your place in it.
    const keepFocus = this.focusInputAfterRender || (this.input !== null && document.activeElement === this.input);
    const draft = this.input?.value ?? "";
    this.focusInputAfterRender = false;
    this.input = null;

    const root = this.contentEl;
    root.empty();
    root.addClass("curious-search");
    renderSwitcher(root, "chat", this.actions.switcher);
    const state = this.state;
    if (!state) {
      root.createDiv({ cls: "curious-search-empty", text: "Press Alt+F to ask something, or type @search: your question in a note." });
      return;
    }

    const header = root.createDiv({ cls: "curious-search-header" });
    header.createDiv({ cls: "curious-search-title", text: state.turns[0]?.query ?? state.pending ?? "New search" });
    const close = header.createEl("button", {
      cls: "curious-answer-button",
      text: "×",
      attr: { "aria-label": "Close search (Esc in the note) and remove its line" },
    });
    close.addEventListener("click", () => this.actions.close());

    const body = root.createDiv({ cls: "curious-search-body" });
    const { turns, sourcePath } = state;
    const selected = this.selected ?? turns.length - 1;

    // The selected chunk is open; the others fold to their question.
    turns.forEach((turn, i) => {
      const chunk = body.createDiv({ cls: "curious-search-chunk" });
      if (i === selected) {
        chunk.addClass("is-selected");
        if (turns.length > 1) {
          chunk.createDiv({ cls: "curious-search-question", text: `${i + 1}/${turns.length} · ${turn.query}` });
        }
        this.renderAttachments(chunk, turn.attachments, false);
        this.renderResult(chunk, turn.result, sourcePath);
        if (turns.length > 1) window.setTimeout(() => chunk.scrollIntoView({ block: "nearest" }));
      } else {
        const summary = chunk.createDiv({ cls: "curious-search-folded", text: `${i + 1}. ${turn.query}` });
        summary.addEventListener("click", () => {
          this.selected = i;
          this.render();
        });
      }
    });

    if (state.pending) {
      if (turns.length > 0) body.createDiv({ cls: "curious-search-question", text: state.pending });
      body.createDiv({ cls: "curious-search-status", text: "Searching…" });
      this.focusInputAfterRender = keepFocus; // come back to the box once answered
      return;
    }
    if (state.error) body.createDiv({ cls: "curious-search-status", text: state.error });

    const suggestions = turns[selected]?.result.followUps ?? [];
    this.renderFollowUps(body, suggestions, state.attachments, keepFocus, draft);
  }

  private renderResult(el: HTMLElement, result: SearchResult, sourcePath: string): void {
    this.markdown(el.createDiv(), result.keyPoints, sourcePath);
    if (result.detail) this.folded(el, "More detail", result.detail, sourcePath, true);
    if (result.sources) {
      const count = (result.sources.match(/^\s*[-*]\s/gm) ?? []).length;
      this.folded(el, count > 0 ? `Sources (${count})` : "Sources", result.sources, sourcePath, false);
    }
    if (result.relatedNotes.length > 0) {
      const links = result.relatedNotes.map((name) => `[[${name}]]`).join(" · ");
      this.markdown(el.createDiv({ cls: "curious-search-related" }), `Your notes on this: ${links}`, sourcePath);
    }
  }

  // "📎 Selection from Beta · 6 lines" chips. `removable`: show a × on each.
  private renderAttachments(parent: HTMLElement, attachments: Attachment[], removable: boolean): void {
    if (attachments.length === 0) return;
    const row = parent.createDiv({ cls: "curious-search-chips" });
    attachments.forEach((attachment, i) => {
      const chip = row.createDiv({ cls: "curious-search-chip", attr: { "aria-label": attachment.text.slice(0, 300) } });
      chip.createSpan({ text: `📎 ${attachment.label}` });
      if (removable) {
        const remove = chip.createEl("button", { cls: "curious-answer-button", text: "×", attr: { "aria-label": "Remove" } });
        remove.addEventListener("click", () => this.actions.removeAttachment(i));
      }
    });
  }

  // Suggested next questions, attached notes, and a box for your question.
  // Everything works from the keyboard:
  //   1–3 + Enter  pick a suggestion       ↑ / ↓ (empty box)  previous / next chunk
  //   Backspace (empty box)  remove the last attachment     Esc  back to the note
  private renderFollowUps(
    parent: HTMLElement,
    suggestions: string[],
    attachments: Attachment[],
    focus: boolean,
    draft: string,
  ): void {
    const section = parent.createDiv({ cls: "curious-search-followups" });
    if (suggestions.length > 0) {
      section.createDiv({ cls: "curious-search-followups-label", text: "Go deeper" });
      suggestions.forEach((question, i) => {
        const button = section.createEl("button", { cls: "curious-search-suggestion", text: `${i + 1}. ${question}` });
        button.addEventListener("click", () => this.actions.followUp(question));
      });
    }

    this.renderAttachments(section, attachments, true);

    const recall = `${this.actions.commandPrefix()}recall:`;
    const hasTurns = (this.state?.turns.length ?? 0) > 0;
    const placeholder = !hasTurns
      ? `Ask about what you attached… (${recall} picks notes)`
      : suggestions.length > 0
        ? `Follow up… (1–3 picks a suggestion, ${recall} picks notes)`
        : `Follow up… (${recall} picks notes)`;
    const input = section.createEl("input", { cls: "curious-search-input", attr: { type: "text", placeholder } });
    input.value = draft;

    // "@recall:" opens the note picker. Your question stays in the box;
    // what you type after "@recall:" pre-fills the picker's search.
    const openPicker = (): boolean => {
      const { question, recall: query } = splitRecall(input.value, this.actions.commandPrefix());
      if (query === null) return false;
      input.value = question ? question + " " : "";
      this.actions.pickNotes(query);
      return true;
    };
    input.addEventListener("input", () => {
      if (input.value.endsWith(recall)) openPicker(); // the moment you finish typing it
    });

    input.addEventListener("keydown", (event) => {
      const empty = input.value === "";
      if (event.key === "Escape") {
        event.preventDefault();
        this.actions.backToNote();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (openPicker()) return;
        const text = input.value.trim();
        const pick = /^[1-3]$/.test(text) ? suggestions[Number(text) - 1] : undefined;
        const question = pick ?? text;
        if (!question) return;
        input.value = ""; // sent; don't carry it over into the next render
        this.actions.followUp(question);
      } else if (empty && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        this.move(event.key === "ArrowUp" ? -1 : 1);
      } else if (empty && event.key === "Backspace" && attachments.length > 0) {
        event.preventDefault();
        this.actions.removeAttachment(attachments.length - 1);
      }
    });
    this.input = input;
    if (focus) input.focus();
  }

  // A section that can be folded away (an HTML <details> element).
  private folded(parent: HTMLElement, label: string, markdown: string, sourcePath: string, open: boolean): void {
    const details = parent.createEl("details", { cls: "curious-search-fold" });
    details.open = open;
    details.createEl("summary", { text: label });
    this.markdown(details.createDiv(), markdown, sourcePath);
  }

  private markdown(el: HTMLElement, markdown: string, sourcePath: string): void {
    MarkdownRenderer.render(this.app, markdown, el, sourcePath, this);
    wireLinks(this.app, el, sourcePath);
  }
}
