// Tracks which command lines you've typed or changed since they last ran.
//
// Enter only runs a command that's "fresh". Without this, pressing Enter at
// the end of a command you already ran (just to make room to write) would
// run it all over again.

import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { parseCommandLine } from "./core/commands";

// Tell the editor a command line has run, so it's no longer fresh.
export const markRan = StateEffect.define<number>(); // the line's start position

export function createFreshCommands(getPrefix: () => string) {
  const field = StateField.define<number[]>({
    // Commands already in a note when you open it start out "ran".
    create: () => [],
    update(fresh, tr) {
      // Keep positions pointing at the same lines as text moves around.
      let lines = fresh.map((pos) => tr.changes.mapPos(pos));

      // Any line you typed into that is (now) a command becomes fresh.
      if (tr.isUserEvent("input") || tr.isUserEvent("delete")) {
        tr.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
          // Enter itself (a bare new line) doesn't count as changing the command.
          if (inserted.length > 0 && inserted.toString().trim() === "") return;
          const doc = tr.state.doc;
          for (let n = doc.lineAt(fromB).number; n <= doc.lineAt(toB).number; n++) {
            const line = doc.line(n);
            if (parseCommandLine(line.text, getPrefix()) && !lines.includes(line.from)) lines.push(line.from);
          }
        });
      }

      for (const effect of tr.effects) {
        if (effect.is(markRan)) lines = lines.filter((pos) => pos !== effect.value);
      }
      return lines;
    },
  });

  return {
    extension: field,
    isFresh: (state: EditorState, lineStart: number) => state.field(field, false)?.includes(lineStart) ?? false,
  };
}
