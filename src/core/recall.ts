// recall: find what you've already written about a topic.
//
// It only points you to your notes and quotes the part that matched. It
// never summarises them, so you do the remembering and connecting yourself.

import { NoteIndex, noteBody, noteName } from "./noteIndex";

// How close a match is, in words. Thresholds come from testing against real
// notes: genuine matches scored about 0.64–0.70, loose ones 0.58–0.60.
export function matchStrength(score: number): string {
  if (score >= 0.68) return "strong match";
  if (score >= 0.62) return "related";
  return "loose match";
}

const MAX_QUOTE_CHARS = 220;

export async function recall(
  index: NoteIndex,
  readNote: (path: string) => Promise<string>,
  query: string,
  options: { limit: number; currentPath?: string; commandPrefix?: string },
) {
  const hits = await index.search(query, options.limit, options.currentPath);
  if (hits.length === 0) {
    return { title: `Nothing found for "${query}" yet`, lines: ["Your notes may still be indexing."] };
  }

  const notes = await Promise.all(
    hits.map(async (hit) => ({ path: hit.path, text: noteBody(await readNote(hit.path), options.commandPrefix) })),
  );
  const passages = await index.bestPassages(query, notes).catch(() => new Map()); // quotes are a bonus

  const lines = hits.flatMap((hit) => {
    // Link by full path (unambiguous), but show only the note's name.
    const link = `[[${hit.path.replace(/\.md$/, "")}|${noteName(hit.path)}]]`;
    const entry = [`- **${link}** · ${matchStrength(hit.score)}`];
    const passage = passages.get(hit.path);
    if (passage) entry.push(`\t- “${quote(passage.text)}”`);
    return entry;
  });
  return { title: `Your notes on "${query}"`, lines };
}

// One line, trimmed to a readable length at a word boundary.
function quote(text: string): string {
  const flat = text.replace(/^\s*[-*+]\s+/gm, "").replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_QUOTE_CHARS) return flat;
  return flat.slice(0, MAX_QUOTE_CHARS).replace(/\s+\S*$/, "") + "…";
}
