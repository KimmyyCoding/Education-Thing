// The note index: one embedding per note, kept up to date as notes change,
// and searchable by meaning rather than exact words.

import { stripCommandOutput } from "./commands";
import { OllamaClient } from "./ollama";

// What the index needs to know about a note. The host app supplies these.
export interface NoteSource {
  path: string;
  mtime: number; // last modified time; used to skip notes that haven't changed
  read: () => Promise<string>;
}

interface IndexEntry {
  mtime: number;
  vector: number[];
}

// Plain object form, for saving to disk.
export type SavedIndex = Record<string, IndexEntry>;

export interface SearchHit {
  path: string;
  score: number; // cosine similarity: closer to 1 means more similar
}

// nomic-embed-text reads at most ~2000 words by default; longer notes are
// cut off here rather than silently by Ollama.
const MAX_CHARS = 6000;
// How many notes to send to Ollama per request.
const BATCH_SIZE = 8;

export class NoteIndex {
  private entries = new Map<string, IndexEntry>();

  constructor(
    private ollama: OllamaClient,
    saved: SavedIndex = {},
    private commandPrefix?: string,
  ) {
    for (const [path, entry] of Object.entries(saved)) this.entries.set(path, entry);
  }

  toJSON(): SavedIndex {
    return Object.fromEntries(this.entries);
  }

  get size(): number {
    return this.entries.size;
  }

  // Bring the index in line with the current notes: embed new or changed
  // ones, drop deleted ones. Returns how many notes were (re)embedded.
  async sync(notes: NoteSource[], onProgress?: (done: number, total: number) => void): Promise<number> {
    const current = new Set(notes.map((n) => n.path));
    for (const path of this.entries.keys()) {
      if (!current.has(path)) this.entries.delete(path);
    }

    const stale = notes.filter((n) => this.entries.get(n.path)?.mtime !== n.mtime);
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE);
      const texts = await Promise.all(
        batch.map(async (n) => toEmbeddingText(n.path, await n.read(), this.commandPrefix)),
      );
      const vectors = await this.ollama.embed(texts, "document");
      batch.forEach((n, j) => this.entries.set(n.path, { mtime: n.mtime, vector: vectors[j] }));
      onProgress?.(Math.min(i + BATCH_SIZE, stale.length), stale.length);
    }
    return stale.length;
  }

  remove(path: string): void {
    this.entries.delete(path);
  }

  rename(oldPath: string, newPath: string): void {
    const entry = this.entries.get(oldPath);
    if (!entry) return;
    this.entries.delete(oldPath);
    this.entries.set(newPath, entry);
  }

  // Find the notes closest in meaning to `query`.
  async search(query: string, limit: number, excludePath?: string): Promise<SearchHit[]> {
    const [queryVector] = await this.ollama.embed([query], "query");
    const hits: SearchHit[] = [];
    for (const [path, entry] of this.entries) {
      if (path === excludePath) continue;
      hits.push({ path, score: cosine(queryVector, entry.vector) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // For each note, the paragraph closest in meaning to `query`, so you can
  // see *why* a note matched. Embeds the paragraphs on the spot (only for
  // these few notes), all in one request to Ollama.
  async bestPassages(query: string, notes: { path: string; text: string }[]): Promise<Map<string, Passage>> {
    const chunks = notes.flatMap((note) => splitPassages(note.text).map((text) => ({ path: note.path, text })));
    const best = new Map<string, Passage>();
    if (chunks.length === 0) return best;

    const [queryVector] = await this.ollama.embed([query], "query");
    const vectors = await this.ollama.embed(chunks.map((c) => c.text), "document");
    chunks.forEach((chunk, i) => {
      const score = cosine(queryVector, vectors[i]);
      if (score > (best.get(chunk.path)?.score ?? -1)) best.set(chunk.path, { text: chunk.text, score });
    });
    return best;
  }
}

export interface Passage {
  text: string;
  score: number;
}

// Paragraphs worth showing: split at blank lines, long ones cut into
// smaller pieces, headings-only and tiny fragments dropped.
const MAX_PASSAGES_PER_NOTE = 40;
function splitPassages(text: string): string[] {
  const pieces: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    let current = "";
    for (const line of paragraph.split("\n")) {
      if (/^#{1,6}\s/.test(line)) continue; // headings alone say little
      if (current.length + line.length > 500 && current) {
        pieces.push(current);
        current = "";
      }
      current += (current ? "\n" : "") + line;
    }
    if (current) pieces.push(current);
  }
  return pieces.map((p) => p.trim()).filter((p) => p.length >= 40).slice(0, MAX_PASSAGES_PER_NOTE);
}

// "School/Depreciation.md" -> "Depreciation", the name used in [[links]].
export function noteName(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "");
}

// A note's own writing: no properties block, no command lines or results.
export function noteBody(content: string, commandPrefix?: string): string {
  return stripCommandOutput(stripFrontmatter(content), commandPrefix);
}

// The note's title carries a lot of meaning, so it goes in front of the body.
function toEmbeddingText(path: string, content: string, commandPrefix?: string): string {
  return `${noteName(path)}\n\n${noteBody(content, commandPrefix)}`.slice(0, MAX_CHARS);
}

// Frontmatter is the "---" block of properties at the top of a note.
function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

// Cosine similarity: how closely two vectors point in the same direction.
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
