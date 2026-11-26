// Answer boxes: shown in the editor under a command line, but never part of
// the note itself. They are drawn on top of the text (a CodeMirror "widget"),
// so nothing is saved to the file, and they disappear when you close them or
// the note.
//
// Your notes should only contain what you wrote.

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { App, Component, MarkdownRenderer } from "obsidian";
import { wireLinks } from "./links";

export interface Answer {
  id: number;
  command: string; // "recall", "ask", ... (used for the box's colour)
  title: string;
  markdown: string; // the body; empty while working
  pending: boolean;
  sourcePath: string; // the note it belongs to, so [[links]] resolve correctly
}

// "Effects" are how CodeMirror is told to change something other than text.
const showAnswer = StateEffect.define<{ pos: number; answer: Answer }>({
  map: (value, changes) => ({ ...value, pos: changes.mapPos(value.pos) }),
});
const closeAnswer = StateEffect.define<number>(); // by answer id

// `onRerun` is called with the position of a box's command line when its ↻
// button is clicked.
export function createAnswers(app: App, onRerun: (view: EditorView, pos: number) => void) {
  // Where the box for answer `id` currently is, or null if it's been closed.
  const findPos = (view: EditorView, id: number): number | null => {
    let pos: number | null = null;
    view.state.field(field, false)?.between(0, view.state.doc.length, (from, _to, deco) => {
      if (deco.spec.answerId === id) pos = from;
    });
    return pos;
  };
  const rerun = (view: EditorView, id: number) => {
    const pos = findPos(view, id);
    if (pos !== null) onRerun(view, pos);
  };

  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(boxes, tr) {
      boxes = boxes.map(tr.changes); // keep boxes under their lines as you type
      for (const effect of tr.effects) {
        if (effect.is(showAnswer)) {
          const { pos, answer } = effect.value;
          // One box per command line: replace this answer, or an older one on the same line.
          const line = tr.state.doc.lineAt(pos);
          boxes = boxes.update({
            filter: (from, _to, deco) => deco.spec.answerId !== answer.id && (from < line.from || from > line.to),
            add: [
              Decoration.widget({
                widget: new AnswerWidget(app, answer, (view) => rerun(view, answer.id)),
                block: true,
                side: 1,
                answerId: answer.id,
              }).range(pos),
            ],
          });
        } else if (effect.is(closeAnswer)) {
          boxes = boxes.update({ filter: (_from, _to, deco) => deco.spec.answerId !== effect.value });
        }
      }
      return boxes;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return {
    extension: field,

    // Open a box under the line that ends at `pos`.
    show(view: EditorView, pos: number, answer: Answer): void {
      view.dispatch({ effects: showAnswer.of({ pos, answer }) });
    },

    // Close the box nearest the cursor. Returns false if there were none.
    closeNearest(view: EditorView): boolean {
      const cursor = view.state.selection.main.head;
      let nearest: { id: number; distance: number } | null = null;
      view.state.field(field, false)?.between(0, view.state.doc.length, (from, _to, deco) => {
        const distance = Math.abs(from - cursor);
        if (!nearest || distance < nearest.distance) nearest = { id: deco.spec.answerId, distance };
      });
      if (!nearest) return false;
      view.dispatch({ effects: closeAnswer.of((nearest as { id: number }).id) });
      return true;
    },

    closeAll(view: EditorView): boolean {
      const ids: number[] = [];
      view.state.field(field, false)?.between(0, view.state.doc.length, (_from, _to, deco) => {
        ids.push(deco.spec.answerId);
      });
      if (ids.length > 0) view.dispatch({ effects: ids.map((id) => closeAnswer.of(id)) });
      return ids.length > 0;
    },

    // Fill in an open box. Does nothing if it was closed or the note changed.
    update(view: EditorView, answer: Answer): void {
      if (!view.dom.isConnected) return;
      const pos = findPos(view, answer.id);
      if (pos !== null) view.dispatch({ effects: showAnswer.of({ pos, answer }) });
    },
  };
}

class AnswerWidget extends WidgetType {
  private static components = new WeakMap<HTMLElement, Component>();

  constructor(
    private app: App,
    private answer: Answer,
    private onRerun: (view: EditorView) => void,
  ) {
    super();
  }

  // Same answer object = nothing to redraw.
  eq(other: AnswerWidget): boolean {
    return other.answer === this.answer;
  }

  toDOM(view: EditorView): HTMLElement {
    const { answer } = this;
    const box = createDiv({ cls: `curious-answer curious-answer-${answer.command}` });

    const header = box.createDiv({ cls: "curious-answer-header" });
    header.createSpan({ cls: "curious-answer-title", text: answer.title });
    if (!answer.pending) {
      const again = header.createEl("button", { cls: "curious-answer-button", text: "↻", attr: { "aria-label": "Run again" } });
      again.addEventListener("click", () => this.onRerun(view));
    }
    const close = header.createEl("button", { cls: "curious-answer-button", text: "×", attr: { "aria-label": "Close" } });
    close.addEventListener("click", () => view.dispatch({ effects: closeAnswer.of(answer.id) }));

    const body = box.createDiv({ cls: "curious-answer-body" });
    if (answer.pending) {
      body.setText("Working…");
    } else {
      // Render the Markdown the same way Obsidian renders notes.
      const component = new Component();
      component.load();
      AnswerWidget.components.set(box, component);
      MarkdownRenderer.render(this.app, answer.markdown, body, answer.sourcePath, component);
    }

    wireLinks(this.app, body, answer.sourcePath);
    return box;
  }

  destroy(dom: HTMLElement): void {
    AnswerWidget.components.get(dom)?.unload();
  }

  // Clicks and text selection inside the box belong to the box, not the editor.
  ignoreEvent(): boolean {
    return true;
  }
}
