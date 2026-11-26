// search: ask a model anything, with web search, like a normal chat question.
//
// Unlike ask, none of your notes are sent. Curious only checks locally
// whether you've written about the topic before and links those notes, so a
// lookup can lead back to your own writing.

import { extractTerms, LinkedTerm } from "./autoLink";
import { LanguageModel } from "./llm";
import { NoteIndex, noteName } from "./noteIndex";

// Similarity needed for a note to count as "on this topic". Below this,
// matches are usually only loosely related.
const RELATED_NOTE_SCORE = 0.62;
const MAX_RELATED_NOTES = 3;

const SYSTEM_PROMPT = `You answer a student's question clearly and accurately.
Search the web when the answer depends on recent or specific facts; otherwise answer from what you know.
If earlier questions and answers are included, the new question is a follow-up: answer it in that context.
If the student attached excerpts from their notes, use them as context: they may ask about them, or want them checked or explained. Point out anything in them that is wrong.

Reply in exactly this format, in Markdown, starting directly with "## Key points". Don't comment on your tools or these instructions.

## Key points
3 to 5 short bullets that together answer the question.

## Detail
A short explanation for anyone who wants more, at most about 150 words.

In Key points and Detail, link the key concepts the student might want to look up (specific products, methods, theories, people, organizations), by making the term itself the link: "Figma is testing this with [Figma Make](https://www.figma.com/make/)". Link each concept once, use the page that best explains it (official site, Wikipedia, or a page you used), and only use URLs you found or are certain exist. Don't link ordinary words.

## Sources
A bulleted list of Markdown links [title](url) to the web pages you used. Leave this section out if you used none.

## Follow-ups
Exactly 3 short questions the student could ask next to go deeper, as a numbered list. Each should build on this answer, not repeat it.`;

export interface SearchResult {
  keyPoints: string; // Markdown
  detail: string; // Markdown, may be empty
  sources: string; // Markdown, may be empty
  followUps: string[]; // suggested next questions
  relatedNotes: string[]; // note names, for [[links]]
  terms: LinkedTerm[]; // concepts the answer linked, for auto-linking
}

// Text from your notes that you chose to send along with a question.
export interface Attachment {
  label: string; // e.g. "Selection from Beta · 6 lines"
  text: string;
}

// One question and its answer, kept so you can follow up on it.
export interface SearchTurn {
  query: string;
  attachments: Attachment[];
  result: SearchResult;
}

// Keeps a big pasted note from making every follow-up huge.
const MAX_ATTACHMENT_CHARS = 6000;

export async function search(
  index: NoteIndex,
  model: LanguageModel,
  query: string,
  currentPath?: string,
  earlier: SearchTurn[] = [],
  attachments: Attachment[] = [],
): Promise<SearchResult> {
  // The model remembers nothing between calls, so a follow-up carries the
  // earlier turns with it (answers only, not sources, to keep it short), and
  // everything attached so far stays attached.
  const attached = [...earlier.flatMap((turn) => turn.attachments), ...attachments].map(
    (a) => `<attached label="${a.label}">\n${a.text.slice(0, MAX_ATTACHMENT_CHARS)}\n</attached>`,
  );
  const history = earlier.map((turn) => `Q: ${turn.query}\nA: ${turn.result.keyPoints}\n${turn.result.detail}`);
  const parts: string[] = [];
  if (attached.length > 0) parts.push(`The student attached these excerpts from their own notes:\n\n${attached.join("\n\n")}`);
  if (history.length > 0) parts.push(`Earlier in this conversation:\n\n${history.join("\n\n")}`);
  parts.push(history.length > 0 ? `Follow-up question: ${query}` : query);
  const prompt = parts.join("\n\n");

  // Run both at once: the web answer is the slow part.
  const [answer, hits] = await Promise.all([
    model.complete(SYSTEM_PROMPT, prompt, { webSearch: true }),
    index.search(query, MAX_RELATED_NOTES, currentPath).catch(() => []), // never fail the answer over this
  ]);
  const sections = splitSections(answer);
  return {
    ...sections,
    relatedNotes: hits.filter((hit) => hit.score >= RELATED_NOTE_SCORE).map((hit) => noteName(hit.path)),
    terms: extractTerms(`${sections.keyPoints}
${sections.detail}`),
  };
}

// Pull the "## ..." sections apart. If the model ignored the format,
// everything ends up under key points, so nothing is lost.
function splitSections(answer: string): Omit<SearchResult, "relatedNotes" | "terms"> {
  const sections: Record<string, string> = { "key points": "", detail: "", sources: "", "follow-ups": "" };
  let current = "key points";
  for (const line of answer.trim().split("\n")) {
    const heading = /^#{1,3}\s*(key points|detail|sources|follow-ups)\s*:?\s*$/i.exec(line.trim());
    if (heading) current = heading[1].toLowerCase();
    else sections[current] += line + "\n";
  }
  return {
    keyPoints: sections["key points"].trim(),
    detail: sections.detail.trim(),
    sources: sections.sources.trim(),
    // "1. Question" or "- Question" -> "Question"
    followUps: sections["follow-ups"]
      .split("\n")
      .map((line) => line.replace(/^\s*(\d+[.)]|[-*])\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}
