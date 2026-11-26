// ask: answer a question from your own notes, then hand the thinking back.
//
// The answer cites the notes it used and ends with one question for you to
// answer in your own words, so asking doesn't replace understanding.

import { LanguageModel } from "./llm";
import { NoteIndex, noteBody, noteName } from "./noteIndex";

export interface AskOptions {
  sources: number; // how many notes to give the model
  commandPrefix?: string;
}

// Enough of each note for context without making every question huge.
const MAX_CHARS_PER_NOTE = 3000;

const SYSTEM_PROMPT = `You help a student understand their own study notes.

Answer the student's question using the notes provided. Rules:
- Be brief: at most about 150 words. Plain Markdown, no headings.
- When you use a note, cite it inline as [[Note name]], using the names exactly as given.
- If the notes don't cover something, say "Your notes don't cover this." and then give a short general answer marked (general knowledge).
- Finish with one final line that starts with "Your turn:" and asks the student a single question that makes them explain or apply the idea in their own words. Do not answer that question.`;

export async function ask(
  index: NoteIndex,
  model: LanguageModel,
  readNote: (path: string) => Promise<string>,
  question: string,
  options: AskOptions,
) {
  // Find the relevant notes locally first, the same way recall does. Only
  // these excerpts and the question are sent to the model.
  const hits = await index.search(question, options.sources);
  const notes = await Promise.all(
    hits.map(async (hit) => ({
      name: noteName(hit.path),
      text: noteBody(await readNote(hit.path), options.commandPrefix).slice(0, MAX_CHARS_PER_NOTE),
    })),
  );

  const prompt = [
    ...notes.map((note) => `<note name="${note.name}">\n${note.text}\n</note>`),
    `Question: ${question}`,
  ].join("\n\n");

  const answer = await model.complete(SYSTEM_PROMPT, prompt);

  // Make the hand-back stand out.
  const lines = answer.trim().split("\n").map((line) => line.replace(/^\s*\**Your turn:?\**:?/, "**Your turn:**"));

  // List which notes the answer drew on, so you can check it against them.
  const cited = notes.filter((note) => answer.includes(`[[${note.name}]]`));
  const listed = cited.length > 0 ? cited : notes;
  if (listed.length > 0) {
    lines.push("", `${cited.length > 0 ? "Sources" : "Searched"}: ${listed.map((n) => `[[${n.name}]]`).join(" · ")}`);
  }

  return { title: question, lines };
}
