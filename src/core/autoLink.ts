// Auto-linking: search answers link key concepts, like [Figma Make](url).
// When you write one of those concepts in your own notes, it becomes a link
// too, so the note keeps the connection without you copying links by hand.
//
//   answer: "…testing this with [Figma Make](https://www.figma.com/make/)…"
//   you:    "Figma is exploring this with Figma Make"
//   note:   "Figma is exploring this with [Figma Make](https://www.figma.com/make/)"
//
// Matching is on the exact term, ignoring capitals and a plural "s"/"es".

// A concept the answer linked.
export interface LinkedTerm {
  term: string; // the link's text, e.g. "Figma Make"
  url: string;
}

// Where a term in your note should point: a web page, or one of your own
// notes with that name (preferred, so your vault connects to itself).
export type LinkTarget = { term: string; url: string; note?: undefined } | { term: string; note: string; url?: undefined };

// Concept names are short; longer link texts are usually whole phrases.
const MAX_TERM_WORDS = 6;

// Every [term](https://...) link in an answer, one per term.
export function extractTerms(markdown: string): LinkedTerm[] {
  const terms = new Map<string, LinkedTerm>();
  for (const [, text, url] of markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    const term = text.replace(/[*_`]/g, "").trim();
    if (term.length < 2 || term.split(/\s+/).length > MAX_TERM_WORDS) continue;
    const key = term.toLowerCase();
    if (!terms.has(key)) terms.set(key, { term, url });
  }
  return [...terms.values()];
}

// Turn mentions of the targets in `line` into links. `skip` says whether a
// target is already linked elsewhere in the note (only the first mention
// gets a link). Returns the new line and which targets were linked.
export function linkLine(
  line: string,
  targets: LinkTarget[],
  skip: (target: LinkTarget) => boolean,
): { text: string; linked: LinkTarget[] } {
  let text = line;
  const linked: LinkTarget[] = [];
  // Longest first, so "Figma Make" wins over "Figma".
  for (const target of [...targets].sort((a, b) => b.term.length - a.term.length)) {
    if (skip(target)) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${termPattern(target.term)}(?![\\p{L}\\p{N}])`, "giu");
    const taken = protectedRanges(text);
    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue; // inside a link or code
      text = text.slice(0, start) + render(target, match[0]) + text.slice(end);
      linked.push(target);
      break; // first mention only
    }
  }
  return { text, linked };
}

// The term as a pattern that also matches its singular or plural:
// "design systems" matches "design system" too, and "beta" matches "betas".
function termPattern(term: string): string {
  // Drop a plural ending, but not from words like "class" or short ones like "bus".
  const singular = term.length > 4 && /[^s]s$/i.test(term) ? term.replace(/e?s$/i, "") : term;
  const escaped = singular.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return `${escaped}(?:e?s)?`;
}

function render(target: LinkTarget, matched: string): string {
  if (target.note === undefined) return `[${matched}](${target.url})`;
  return matched.toLowerCase() === target.note.toLowerCase() ? `[[${target.note}]]` : `[[${target.note}|${matched}]]`;
}

// Parts of a line that must not be linked again: existing links, [[links]],
// `code` and bare URLs.
function protectedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(/\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)|`[^`]*`|https?:\/\/\S+/g)) {
    ranges.push([m.index!, m.index! + m[0].length]);
  }
  return ranges;
}
