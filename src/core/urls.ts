// Finding web links in note text: [text](https://…), <https://…> and bare
// https://… addresses. Plain text in, plain data out, so it's easy to test.

export interface FoundLink {
  url: string;
  from: number; // where the link's text starts and ends in the text searched
  to: number;
}

// An address may contain (balanced) brackets, like Wikipedia's
// .../wiki/Beta_(finance), so a ")" only ends it when it's unmatched.
const ADDRESS = String.raw`https?:\/\/(?:[^\s<>()\[\]]|\([^\s()]*\))+`;

// One pattern per kind of link; the first group is the address.
const PATTERNS = [
  new RegExp(String.raw`\[[^\]]*\]\((${ADDRESS})(?:\s+"[^"]*")?\)`, "g"), // [text](url "title")
  /<(https?:\/\/[^>\s]+)>/g, // <url>
  new RegExp(String.raw`(?<![(<\w])(${ADDRESS})`, "g"), // bare url
];

export function findLinks(text: string): FoundLink[] {
  const links: FoundLink[] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      let url = match[1];
      const from = match.index!;
      let to = from + match[0].length;
      // A bare address doesn't end in the punctuation of the sentence around it.
      if (match[0] === url) {
        url = url.replace(/[.,;:!?'"]+$/, "");
        to = from + url.length;
      }
      // A bare-URL match inside a [text](url) link is the same link.
      if (links.some((l) => from < l.to && to > l.from)) continue;
      links.push({ url, from, to });
    }
  }
  return links.sort((a, b) => a.from - b.from);
}

// The link the cursor or selection is on (from..to), or else the first link
// inside the selection. Null if there's none.
export function linkAt(text: string, from: number, to: number): string | null {
  const links = findLinks(text);
  const touching = links.find((l) => from <= l.to && to >= l.from);
  return touching?.url ?? null;
}
