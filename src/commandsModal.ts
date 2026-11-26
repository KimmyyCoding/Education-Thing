// The pop-up @commands opens: every command and keyboard shortcut in one
// place. Esc closes it, like any Obsidian pop-up.

import { App, Modal } from "obsidian";

interface CommandHelp {
  usage: string;
  what: string;
  sends: string;
}

const COMMANDS: CommandHelp[] = [
  {
    usage: "recall: topic",
    what: "Lists your notes on a topic, each with how strong the match is and the passage that matched.",
    sends: "Nothing, fully local",
  },
  {
    usage: "ask: question",
    what: "Answers from your notes, cites them, and ends with a \"Your turn\" question.",
    sends: "Question + excerpts of relevant notes, to Claude",
  },
  {
    usage: "search: question",
    what: "Asks Claude anything, with web search. Opens in the side panel with 3 \"go deeper\" follow-ups; closing it removes the line. While it's open, concepts the answer linked (like Figma Make) become links when you write them in that note.",
    sends: "Only the question, to Claude",
  },
  {
    usage: "tag",
    what: "Suggests tags for this note, each with a reason, preferring tags you already use. Nothing is added until you confirm. Also Alt+T.",
    sends: "The note's text, to Claude (or nothing, if set to the local model)",
  },
  {
    usage: "commands",
    what: "Shows this list. The line removes itself.",
    sends: "Nothing",
  },
];

const KEYS: [string, string][] = [
  ["Enter", "Run a command you just typed or changed"],
  ["Esc", "Close the nearest answer box, then the search panel (which also removes its @search line)"],
  ["Alt+F", "Go to the chat in the side pane (starts an empty one if none is open). Type a question, or 1–3 for a suggestion, then Enter. Esc returns to your note"],
  ["Alt+A", "Attach the selected text (or the whole note) to the search, like pasting it in, then type your question. Starts a search if none is open"],
  ["@recall: (in the follow-up box) or Alt+N", "Open the note picker: scroll all notes, or type a name or roughly what it's about. ↵ attaches, Shift+↵ attaches and keeps picking. Your question stays in the box"],
  ["Alt+[ / Alt+]", "Previous / next answer in the search (or ↑ / ↓ in the empty follow-up box)"],
  ["Backspace", "In the empty follow-up box: remove the last attachment"],
  ["Alt+E", "Suggest edits to the selected text (also on the right-click menu). Say how it should change, or 1–4 for a ready-made one, and see each change and why. Enter accepts, or type feedback to try again. Nothing changes until you accept"],
  ["Alt+O", "On a web link: open it in the side pane, as a Web tab next to the chat (also on the right-click menu). Anywhere else: go to the Web tab, or type an address or search. From the page, Alt+O goes back to your note"],
  ["Alt+J / Alt+K", "Scroll the browser down / up while you stay in your note; on a PDF, turn a whole page. Alt+= / Alt+- zoom the browser"],
  ["In a web PDF", "PDFs from links open in Obsidian's PDF viewer, fitted so one page fills the pane (saved to the Web PDFs folder). j / k next / previous page · Esc back to your note"],
  ["In the browser page", "f shows a letter on every link: type it to follow · j/k scroll · H/L back/forward · o address or search · Alt+F to the chat · Esc back to your note. The list is always shown at the bottom of the pane"],
  ["Alt+R", "Run the command on the current line again (or use ↻ on its box)"],
  ["Alt+X", "Close all answer boxes in the note"],
  ["Alt+C", "Show this list"],
  ["Ctrl+O", "Open a note named in an answer without the mouse (Obsidian's quick switcher)"],
];

export class CommandsModal extends Modal {
  constructor(
    app: App,
    private prefix: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle("Curious commands");
    contentEl.addClass("curious-commands");

    contentEl.createEl("p", {
      cls: "curious-commands-hint",
      text: "Type a command on its own line, then press Enter. Answers are never saved into your notes.",
    });

    const commands = contentEl.createEl("table");
    const head = commands.createEl("tr");
    for (const label of ["Command", "What it does", "Sends"]) head.createEl("th", { text: label });
    for (const command of COMMANDS) {
      const row = commands.createEl("tr");
      row.createEl("td").createEl("code", { text: this.prefix + command.usage });
      row.createEl("td", { text: command.what });
      row.createEl("td", { cls: "curious-commands-sends", text: command.sends });
    }

    contentEl.createEl("h4", { text: "Keyboard" });
    const keys = contentEl.createEl("table");
    for (const [key, what] of KEYS) {
      const row = keys.createEl("tr");
      row.createEl("td").createEl("kbd", { text: key });
      row.createEl("td", { text: what });
    }

    contentEl.createEl("p", {
      cls: "curious-commands-hint",
      text: "Change the @ symbol, models and limits in Settings → Curious. Change any shortcut in Settings → Hotkeys (search \"Curious\").",
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
