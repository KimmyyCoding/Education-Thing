// The command system: recognising "@name: argument" lines and formatting
// their results. Nothing in core/ imports Obsidian, so it can move to a
// standalone app later unchanged.

export interface ParsedCommand {
  name: string; // e.g. "recall"
  arg: string; // e.g. "depreciation"
}

// The symbol that starts a command. Not "#": Obsidian treats that as a tag
// and its tag popup swallows the Enter key.
export const DEFAULT_PREFIX = "@";

// Commands that take no argument and can be written on their own, like
// "@commands" or "@tag". Every other command needs "name: something".
const NO_ARGUMENT = new Set(["commands", "tag"]);

// A command is a whole line: "@recall: depreciation".
// The name is lowercase letters only and must be followed by ":", so an
// ordinary "@someone" in a sentence is never mistaken for a command. The
// only exceptions are the few names in NO_ARGUMENT.
export function parseCommandLine(line: string, prefix = DEFAULT_PREFIX): ParsedCommand | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^\\s*${escaped}([a-z]+)(?::\\s*(.*?))?\\s*$`).exec(line);
  if (!match) return null;
  const [, name, arg = ""] = match;
  if (arg === "" && !NO_ARGUMENT.has(name)) return null;
  return { name, arg };
}

// Split a chat message into its question and an optional "@recall: topic"
// part, which can come anywhere after the question:
//   "@recall: beta"                     -> { question: "", recall: "beta" }
//   "how does this fit CAPM? @recall: beta" -> { question: "how does this fit CAPM?", recall: "beta" }
//   "how does this fit CAPM? @recall:"  -> { question: "how does this fit CAPM?", recall: "" }
//   "what is beta?"                     -> { question: "what is beta?", recall: null }
// recall is null only when there's no "@recall:" at all. It must start the
// message or follow a space, so "me@recall:" isn't one.
export function splitRecall(text: string, prefix = DEFAULT_PREFIX): { question: string; recall: string | null } {
  const marker = `${prefix}recall:`;
  let at = text.indexOf(marker);
  while (at > 0 && !/\s/.test(text[at - 1])) at = text.indexOf(marker, at + 1);
  if (at === -1) return { question: text.trim(), recall: null };
  return { question: text.slice(0, at).trim(), recall: text.slice(at + marker.length).trim() };
}

// Strip every command line, so commands don't affect what a note is "about"
// when it gets embedded. Also strips the "> [!recall] ..." result blocks that
// early versions of Curious wrote into notes.
export function stripCommandOutput(text: string, prefix = DEFAULT_PREFIX): string {
  const kept: string[] = [];
  let afterCommand = false; // previous line was a command
  let inResult = false; // inside a result block
  for (const line of text.split("\n")) {
    if (parseCommandLine(line, prefix)) {
      afterCommand = true;
      inResult = false;
      continue;
    }
    if (afterCommand && /^> \[![a-z]+\]/.test(line)) inResult = true;
    afterCommand = false;
    if (inResult && line.startsWith(">")) continue;
    inResult = false;
    kept.push(line);
  }
  return kept.join("\n");
}
