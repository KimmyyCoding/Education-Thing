// Tag suggestions for a note. Suggestions only: you choose what gets added.
//
// Built around a few habits of experienced Obsidian users:
// - Reuse the tags you already have rather than inventing near-duplicates.
// - Allow nested tags (finance/valuation) when a topic has subtopics.
// - Keep it to a few useful tags, each with a reason, so tagging stays
//   lightweight and doesn't turn into admin.
// - Tag topics and contexts, not descriptive details like status or source
//   (those belong in a note's other properties).

import { LanguageModel } from "./llm";

export interface TagCount {
  tag: string; // without "#", e.g. "finance/valuation"
  count: number; // how many notes use it
}

export interface TagSuggestion {
  tag: string;
  reason: string;
  isNew: boolean; // not used anywhere in the vault yet
}

export interface TagRequest {
  noteName: string;
  noteText: string;
  currentTags: string[]; // already on this note
  vaultTags: TagCount[]; // every tag in use, most used first
  similarNoteTags: TagCount[]; // tags on the notes most like this one
}

const MAX_SUGGESTIONS = 5;
const MAX_NOTE_CHARS = 4000; // the local model has a small context
const MAX_VAULT_TAGS = 150;

const SYSTEM_PROMPT = `You suggest tags for a student's note in Obsidian.

Rules:
- Suggest 2 to 5 tags that say what topics or contexts the note belongs to.
- Strongly prefer tags from the existing list. Only make a new tag when nothing existing fits.
- New tags: lowercase, words joined with hyphens. Use a parent/child tag (e.g. finance/valuation) only when the topic clearly sits inside a broader one.
- Don't tag status, source, dates or note type (draft, todo, book, lecture) unless the note is clearly about that.
- Don't repeat tags the note already has.
- For each tag, give a short reason (under 12 words) based on the note.

Reply with JSON only: {"tags":[{"tag":"...","reason":"..."}]}`;

// For local models that can be held to an exact shape.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tags: {
      type: "array",
      items: {
        type: "object",
        properties: { tag: { type: "string" }, reason: { type: "string" } },
        required: ["tag", "reason"],
      },
    },
  },
  required: ["tags"],
};

export async function suggestTags(model: LanguageModel, request: TagRequest): Promise<TagSuggestion[]> {
  const existing = request.vaultTags.slice(0, MAX_VAULT_TAGS);
  const lines = [
    `Existing tags in the vault (with how many notes use each): ${
      existing.length > 0 ? existing.map((t) => `${t.tag} (${t.count})`).join(", ") : "none yet"
    }`,
  ];
  if (request.similarNoteTags.length > 0) {
    lines.push(
      `Tags on the most similar notes (a hint for consistency, not a rule): ${request.similarNoteTags
        .map((t) => `${t.tag} (${t.count})`)
        .join(", ")}`,
    );
  }
  lines.push(`Tags this note already has: ${request.currentTags.join(", ") || "none"}`);
  lines.push(`Note title: ${request.noteName}\n\nNote:\n${request.noteText.slice(0, MAX_NOTE_CHARS)}`);

  const reply = await model.complete(SYSTEM_PROMPT, lines.join("\n\n"), { jsonSchema: RESPONSE_SCHEMA });
  return cleanSuggestions(parseReply(reply), request);
}

// Models sometimes wrap JSON in prose or ``` fences; find the object.
function parseReply(reply: string): { tag: string; reason: string }[] {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1));
    return Array.isArray(parsed.tags) ? parsed.tags.filter((t: any) => typeof t?.tag === "string") : [];
  } catch {
    return [];
  }
}

function cleanSuggestions(raw: { tag: string; reason: string }[], request: TagRequest): TagSuggestion[] {
  // Compare tags loosely so "Valuations", "valuation" and "#valuation" count
  // as the same tag, and map near-duplicates onto the tag you already use.
  const existingByKey = new Map(request.vaultTags.map((t) => [looseKey(t.tag), t.tag]));
  const current = new Set(request.currentTags.map(looseKey));
  const seen = new Set<string>();
  const suggestions: TagSuggestion[] = [];

  for (const { tag, reason } of raw) {
    const normal = normalizeTag(tag);
    if (!normal) continue;
    const key = looseKey(normal);
    if (current.has(key) || seen.has(key)) continue;
    seen.add(key);
    const existing = existingByKey.get(key);
    suggestions.push({ tag: existing ?? normal, reason: (reason ?? "").trim(), isNew: !existing });
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

// "#Capital Budgeting" -> "capital-budgeting". Obsidian tags can't contain
// spaces and must include at least one non-number character.
export function normalizeTag(tag: string): string {
  const cleaned = tag
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_/-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "");
  return /[^\d/]/.test(cleaned) ? cleaned : "";
}

// Ignores hyphens, underscores and a plural "s" on each part.
function looseKey(tag: string): string {
  return normalizeTag(tag)
    .split("/")
    .map((part) => part.replace(/[-_]/g, "").replace(/s$/, ""))
    .join("/");
}
