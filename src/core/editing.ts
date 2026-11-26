// Suggested edits to text you selected. Only runs when you ask for it, and
// nothing changes in the note until you accept the suggestion.
//
// The model also says what it changed and why, so you can learn from the
// edit rather than just take it.

import { LanguageModel } from "./llm";

export interface EditRequest {
  noteName: string;
  selection: string; // the text to edit
  instruction: string; // what you want, e.g. "make it clearer"
  before: string; // text just before the selection, for context only
  after: string; // text just after it
  // When refining: the last suggestion and what you said about it.
  previous?: { text: string; feedback: string };
}

export interface EditSuggestion {
  text: string; // the edited selection
  changes: string[]; // short notes: what changed and why
}

// Ready-made instructions, offered as 1–4 in the pop-up.
export const PRESETS = [
  "Fix spelling and grammar",
  "Make it clearer",
  "Make it shorter",
  "Check it's correct and fix any mistakes",
];

const CONTEXT_CHARS = 1000;

const SYSTEM_PROMPT = `You edit a passage a student selected in their Obsidian notes, following their instruction.

Rules:
- Edit only the selected passage. The text around it is context; never repeat it.
- Keep the student's voice and wording wherever the instruction doesn't require a change. Make the smallest edit that does the job.
- Keep the Markdown: [[links]], [text](url) links, #tags, **bold**, lists, headings, code, LaTeX and line breaks.
- If the instruction asks you to check facts, fix what is wrong and say so in the changes.
- List each change in under 15 words, saying why it helps. If nothing needs changing, return the passage unchanged and say so.

Reply with JSON only: {"text":"<the edited passage>","changes":["..."]}`;

export async function suggestEdit(model: LanguageModel, request: EditRequest): Promise<EditSuggestion> {
  const parts = [
    `Note title: ${request.noteName}`,
    `Text before the selection (context, don't edit):\n${request.before.slice(-CONTEXT_CHARS) || "(start of note)"}`,
    `Selected passage to edit:\n<<<\n${request.selection}\n>>>`,
    `Text after the selection (context, don't edit):\n${request.after.slice(0, CONTEXT_CHARS) || "(end of note)"}`,
    `Instruction: ${request.instruction}`,
  ];
  if (request.previous) {
    parts.push(
      `Your last suggestion was:\n<<<\n${request.previous.text}\n>>>\nThe student said: ${request.previous.feedback}\nEdit the original passage again, taking this into account.`,
    );
  }

  const reply = await model.complete(SYSTEM_PROMPT, parts.join("\n\n"));
  const parsed = parseReply(reply);
  if (!parsed) throw new Error("Claude's reply wasn't in the expected format. Try again.");
  return parsed;
}

// Models sometimes wrap JSON in prose or ``` fences; find the object.
function parseReply(reply: string): EditSuggestion | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1));
    if (typeof parsed.text !== "string") return null;
    const changes = Array.isArray(parsed.changes) ? parsed.changes.filter((c: unknown) => typeof c === "string") : [];
    return { text: parsed.text, changes };
  } catch {
    return null;
  }
}

// ---- Showing what changed -------------------------------------------------

export interface DiffPart {
  kind: "same" | "removed" | "added";
  text: string;
}

// Word-by-word comparison of two texts, so the pop-up can strike out
// removed words and highlight added ones.
//
// It finds the longest run of words both texts share in order (the classic
// "longest common subsequence"); everything else was removed or added.
export function diffWords(oldText: string, newText: string): DiffPart[] {
  // Split into words and the spaces between them, keeping both.
  const a = oldText.split(/(\s+)/).filter(Boolean);
  const b = newText.split(/(\s+)/).filter(Boolean);

  // Very long passages would make the table huge; just show old vs new.
  if (a.length * b.length > 4_000_000) {
    return [
      { kind: "removed", text: oldText },
      { kind: "added", text: newText },
    ];
  }

  // shared[i][j] = how many words a[i..] and b[j..] have in common, in order.
  const shared: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      shared[i][j] = a[i] === b[j] ? shared[i + 1][j + 1] + 1 : Math.max(shared[i + 1][j], shared[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
      // Removed words go before the words that replace them.
    } else if (i < a.length && (j === b.length || shared[i + 1][j] >= shared[i][j + 1])) {
      push("removed", a[i++]);
    } else {
      push("added", b[j++]);
    }
  }
  return parts;
}
