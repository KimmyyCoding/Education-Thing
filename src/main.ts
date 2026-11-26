// The Obsidian adapter: the only part of Curious that knows about Obsidian.
// It connects the editor and the vault to the portable logic in core/.

import { EditorView, keymap, ViewUpdate } from "@codemirror/view";
import { debounce, Editor, editorInfoField, getAllTags, MarkdownView, Notice, Plugin, requestUrl, TFile, WorkspaceLeaf } from "obsidian";
import { Answer, createAnswers } from "./answers";
import { CommandsModal } from "./commandsModal";
import { NotePicker } from "./notePicker";
import { TagModal } from "./tagModal";
import { EditModal } from "./editModal";
import { AddressModal, BROWSER_VIEW, BrowserView, debug, setBrowserDebug } from "./browserView";
import { SwitcherActions } from "./paneSwitcher";
import { fitPage, isFitted, savePdf, turnPage, whenPdfReady } from "./webPdf";
import { createShortcutHints, hotkeyText, LEARNED_AFTER } from "./shortcutHints";
import { createFreshCommands, markRan } from "./freshCommands";
import { ask } from "./core/ask";
import { LinkTarget, linkLine } from "./core/autoLink";
import { suggestEdit } from "./core/editing";
import { linkAt } from "./core/urls";
import { ClaudeCodeModel } from "./core/claudeCode";
import { parseCommandLine } from "./core/commands";
import { NoteIndex, noteBody, NoteSource, SavedIndex } from "./core/noteIndex";
import { LanguageModel } from "./core/llm";
import { OllamaChatModel, OllamaClient } from "./core/ollama";
import { recall } from "./core/recall";
import { search } from "./core/search";
import { suggestTags, TagCount } from "./core/tagging";
import { SEARCH_VIEW, SearchPanel, SearchState } from "./searchPanel";
import { CuriousSettings, CuriousSettingTab, DEFAULT_SETTINGS } from "./settings";

// How many notes use each tag, most used first.
function countTags(tags: string[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

interface SavedData {
  settings: CuriousSettings;
  index: SavedIndex;
}

// What a command produces: a title and the Markdown lines under it.
type CommandResult = { title: string; lines: string[] };
type CommandHandler = (arg: string, file: TFile | null) => Promise<CommandResult>;

export default class CuriousPlugin extends Plugin {
  settings: CuriousSettings = DEFAULT_SETTINGS;
  private index!: NoteIndex;
  private statusBar!: HTMLElement;
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  private answers!: ReturnType<typeof createAnswers>;
  private answerCount = 0;
  private fresh!: ReturnType<typeof createFreshCommands>;
  private lastNoteLeaf: WorkspaceLeaf | null = null; // where the browser's Esc returns to
  private lastWebLeaf: WorkspaceLeaf | null = null; // the browser or web PDF you were last on
  private currentLeaf: WorkspaceLeaf | null = null; // the pane you're in right now
  private browserHint!: HTMLElement;

  // The Chat · Web switch at the top of the side pane, shared by both.
  private switcher: SwitcherActions = {
    switchTo: (pane) => void (pane === "chat" ? this.focusFollowUp() : this.goToWeb()),
    keyFor: (pane) => hotkeyText(this.app, pane === "chat" ? "follow-up-search" : "open-link-beside"),
  };

  // The search currently shown in the side panel, so closing it can remove
  // its "@search: ..." line from the note.
  private activeSearch: {
    id: number;
    filePath: string;
    commandText: string;
    editorView: EditorView; // the note it came from, to return focus to
    state: SearchState;
  } | null = null;

  // Commands whose answer shows in a box under the line. Adding a command =
  // adding one entry. (@search is different: it uses the side panel.)
  private commands: Record<string, CommandHandler> = {
    recall: async (arg, file) => {
      await this.syncIndex(); // make sure recent edits are searchable
      return recall(this.index, (path) => this.readNote(path), arg, {
        limit: this.settings.recallLimit,
        currentPath: file?.path,
        commandPrefix: this.settings.commandPrefix,
      });
    },
    ask: async (arg) => {
      await this.syncIndex();
      return ask(this.index, this.makeModel(), (path) => this.readNote(path), arg, {
        sources: this.settings.askSources,
        commandPrefix: this.settings.commandPrefix,
      });
    },
  };

  async onload() {
    const saved: Partial<SavedData> = (await this.loadData()) ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    this.index = new NoteIndex(this.makeOllama(), saved.index, this.settings.commandPrefix);

    this.statusBar = this.addStatusBarItem();
    // While the browser is open: how to read it without leaving the note.
    this.browserHint = this.addStatusBarItem();
    this.browserHint.addClass("curious-browser-hint");
    const updateBrowserHint = () => this.updateBrowserHint();
    this.registerEvent(this.app.workspace.on("layout-change", updateBrowserHint));
    this.registerEvent(this.app.workspace.on("active-leaf-change", updateBrowserHint));
    this.addSettingTab(new CuriousSettingTab(this.app, this));
    this.registerView(
      SEARCH_VIEW,
      (leaf) =>
        new SearchPanel(leaf, {
          close: () => {
            this.closeSearch();
            this.backToNote();
          },
          followUp: (question) => this.searchTurn(question),
          pickNotes: (initialQuery) => this.pickNotes(initialQuery),
          commandPrefix: () => this.settings.commandPrefix,
          removeAttachment: (index) => this.removeAttachment(index),
          backToNote: () => this.backToNote(),
          switcher: this.switcher,
        }),
    );

    // TEMPORARY: browser debug log, see browserView.ts.
    const debugLog = `${this.manifest.dir}/debug-browser.log`;
    setBrowserDebug((line) => void this.app.vault.adapter.append(debugLog, line + "\n").catch(() => {}));
    this.registerView(
      BROWSER_VIEW,
      (leaf) =>
        new BrowserView(leaf, {
          zoomFor: (site) => this.settings.browserZoom[site],
          saveZoom: (site, zoom) => {
            this.settings.browserZoom[site] = zoom;
            this.saveZoomSoon();
          },
          toNote: () => this.backToWriting(),
          switcher: this.switcher,
          openPdf: (url, title) => void this.openPdf(url, title),
        }),
    );
    // Remember the note you were last in, so the browser can send you back,
    // and the web page you were last on (browser or PDF), so Alt+O returns
    // to it.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view.getViewType() === "markdown") this.lastNoteLeaf = leaf;
        if (leaf && this.isWebLeaf(leaf)) this.lastWebLeaf = leaf;
        this.currentLeaf = leaf;
        // A web PDF that hasn't been set up yet (e.g. opened by an older
        // version, or restored at startup): fit it and add its key list.
        if (leaf && leaf.view.getViewType() === "pdf" && this.isWebLeaf(leaf)) void this.setUpPdf(leaf);
      }),
    );
    // Keys inside a web PDF, like the browser's: j / k next / previous page,
    // Esc back to your note.
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!["Escape", "j", "k"].includes(event.key) || document.querySelector(".modal-container")) return;
      const leaf = this.currentLeaf;
      if (!leaf || leaf.view.getViewType() !== "pdf" || !this.isWebLeaf(leaf)) return;
      const focused = document.activeElement;
      // Focus is in the PDF (or nowhere in particular), not in a text box like its search.
      if (focused && focused !== document.body && !leaf.view.containerEl.contains(focused)) return;
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (event.key === "Escape") this.backToWriting();
      else turnPage(leaf.view, leaf.view.containerEl, event.key === "j" ? 1 : -1);
    });
    // A fitted PDF stays fitted when you resize the pane.
    this.registerEvent(
      this.app.workspace.on("resize", () => {
        for (const leaf of this.app.workspace.getLeavesOfType("pdf")) {
          if (this.isWebLeaf(leaf) && isFitted(leaf.view)) fitPage(leaf.view);
        }
      }),
    );

    // Pressing Enter at the end of an "@name: ..." line runs it, and the
    // answer shows in a box under the line (not saved in the note).
    this.answers = createAnswers(this.app, (view, pos) => {
      // The box's ↻ button: run its command line again.
      const file = view.state.field(editorInfoField, false)?.file ?? null;
      this.runCommand(view, view.state.doc.lineAt(pos).number, file);
    });
    this.fresh = createFreshCommands(() => this.settings.commandPrefix);
    this.registerEditorExtension([
      this.answers.extension,
      this.fresh.extension,
      createShortcutHints({
        enabled: () => this.settings.shortcutHints,
        isLearned: (id) => this.isLearned(id),
        keyFor: (id) => hotkeyText(this.app, id),
      }),
      // Esc closes the nearest answer box, or else the open search. If
      // neither is open, Esc does whatever it normally would.
      keymap.of([{ key: "Escape", run: (view) => this.answers.closeNearest(view) || this.closeSearch() }]),
      EditorView.updateListener.of((update) => this.onEditorUpdate(update)),
    ]);
    console.log(`Curious ${this.manifest.version} loaded`);

    this.addCommand({
      id: "run-line-command",
      hotkeys: [{ modifiers: ["Alt"], key: "R" }],
      name: "Run command on current line",
      editorCallback: (editor, ctx) => {
        if (!this.runCommand(this.cmView(editor), editor.getCursor().line + 1, ctx.file)) {
          new Notice(`No command on this line. Try "${this.settings.commandPrefix}recall: topic".`);
        }
      },
    });

    this.addCommand({
      id: "close-answer",
      name: "Close answer box",
      editorCallback: (editor) => this.answers.closeNearest(this.cmView(editor)),
    });

    this.addCommand({
      id: "close-all-answers",
      hotkeys: [{ modifiers: ["Alt"], key: "X" }],
      name: "Close all answer boxes",
      editorCallback: (editor) => this.answers.closeAll(this.cmView(editor)),
    });

    this.addCommand({
      id: "show-commands",
      hotkeys: [{ modifiers: ["Alt"], key: "C" }],
      name: "Show commands",
      callback: () => this.showCommands(),
    });

    this.addCommand({
      id: "follow-up-search",
      hotkeys: [{ modifiers: ["Alt"], key: "F" }],
      name: "Follow up on search",
      callback: () => this.focusFollowUp(),
    });

    this.addCommand({
      id: "attach-to-search",
      hotkeys: [{ modifiers: ["Alt"], key: "A" }],
      name: "Attach selection (or whole note) to search",
      editorCallback: (editor, ctx) => {
        this.usedShortcut("attach-to-search");
        this.attachToSearch(editor, ctx.file);
      },
    });

    this.addCommand({
      id: "suggest-tags",
      hotkeys: [{ modifiers: ["Alt"], key: "T" }],
      name: "Suggest tags for this note",
      editorCallback: (_editor, ctx) => {
        if (ctx.file) this.suggestTagsFor(ctx.file);
      },
    });

    this.addCommand({
      id: "open-link-beside",
      hotkeys: [{ modifiers: ["Alt"], key: "O" }],
      name: "Open link beside the note, or switch to the browser",
      // On a link: open it. Otherwise: jump into the open browser, or ask
      // for an address if there isn't one. (In the page, Alt+O comes back.)
      callback: () => {
        this.usedShortcut("open-link-beside");
        // Already on the web page (e.g. a PDF): back to the note.
        const active = this.app.workspace.getMostRecentLeaf();
        if (active && this.isWebLeaf(active) && active.view.containerEl.contains(document.activeElement)) {
          return this.backToWriting();
        }
        // Only a note you are in counts (not, say, the chat box).
        const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        const url = editor ? this.linkUnderCursor(editor) : null;
        if (url) void this.openBeside(url);
        else void this.goToWeb();
      },
    });

    this.addCommand({
      id: "browser-address",
      name: "Browser: open address or search",
      callback: () => {
        const browser = this.browser();
        if (browser) browser.askAddress();
        else this.askAddress();
      },
    });

    // Read the page while you keep writing: these work from the note, on
    // the web page you were last on (the browser, or a web PDF).
    const browserKeys: [string, string, string, (leaf: WorkspaceLeaf) => void][] = [
      ["browser-scroll-down", "Browser: scroll down", "J", (leaf) => this.scrollWeb(leaf, 0.8)],
      ["browser-scroll-up", "Browser: scroll up", "K", (leaf) => this.scrollWeb(leaf, -0.8)],
      ["browser-zoom-in", "Browser: zoom in", "=", (leaf) => this.zoomWeb(leaf, 0.1)],
      ["browser-zoom-out", "Browser: zoom out", "-", (leaf) => this.zoomWeb(leaf, -0.1)],
    ];
    for (const [id, name, key, run] of browserKeys) {
      this.addCommand({
        id,
        name,
        hotkeys: [{ modifiers: ["Alt"], key }],
        checkCallback: (checking) => {
          const leaf = this.webLeaf();
          if (!leaf) return false; // only offered while a web page is open
          if (!checking) {
            if (id.startsWith("browser-scroll")) this.usedShortcut("browser-scroll");
            run(leaf);
          }
          return true;
        },
      });
    }

    this.addCommand({
      id: "suggest-edits",
      hotkeys: [{ modifiers: ["Alt"], key: "E" }],
      name: "Suggest edits to selection",
      editorCallback: (editor, ctx) => {
        this.usedShortcut("suggest-edits");
        this.suggestEditsFor(editor, ctx.file);
      },
    });

    // Also on the right-click menu, when text is selected.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        const url = this.linkUnderCursor(editor);
        if (url) {
          menu.addItem((item) =>
            item
              .setTitle("Curious: open link beside note")
              .setIcon("globe")
              .onClick(() => this.openBeside(url)),
          );
        }
        if (!editor.somethingSelected()) return;
        menu.addItem((item) =>
          item
            .setTitle("Curious: suggest edits")
            .setIcon("pencil")
            .onClick(() => this.suggestEditsFor(editor, info.file)),
        );
      }),
    );

    this.addCommand({
      id: "pick-notes",
      hotkeys: [{ modifiers: ["Alt"], key: "N" }],
      name: "Pick notes to attach to search",
      editorCallback: (editor, ctx) => this.pickNotes("", editor, ctx.file),
    });

    this.addCommand({
      id: "previous-answer",
      hotkeys: [{ modifiers: ["Alt"], key: "[" }],
      name: "Previous answer in search",
      callback: () => this.searchPanel()?.move(-1),
    });

    this.addCommand({
      id: "next-answer",
      hotkeys: [{ modifiers: ["Alt"], key: "]" }],
      name: "Next answer in search",
      callback: () => this.searchPanel()?.move(1),
    });

    this.addCommand({
      id: "close-search",
      name: "Close search (removes its @search line)",
      callback: () => this.closeSearch(),
    });

    this.addCommand({
      id: "rebuild-index",
      name: "Rebuild note index",
      callback: () => this.rebuildIndex(),
    });

    // Keep the index fresh. Edits are batched so typing doesn't trigger
    // an embedding on every keystroke.
    const syncSoon = debounce(() => this.syncIndex(), 3000, true);
    this.registerEvent(this.app.vault.on("modify", syncSoon));
    this.registerEvent(this.app.vault.on("create", syncSoon));
    this.registerEvent(this.app.vault.on("delete", syncSoon));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.index.rename(oldPath, file.path); // same content, no need to re-embed
        syncSoon();
      }),
    );

    // Index once Obsidian has finished loading the vault.
    this.app.workspace.onLayoutReady(() => this.syncIndex());
    // Web PDFs already open (from before a restart or a reload of Curious).
    this.app.workspace.onLayoutReady(() => {
      for (const leaf of this.app.workspace.getLeavesOfType("pdf")) if (this.isWebLeaf(leaf)) void this.setUpPdf(leaf);
    });
    this.reloadWhenRebuilt();
  }

  // While developing: when a new build of Curious lands, reload it, so you
  // don't have to restart Obsidian to see changes. Only active when the
  // build has put a ".hotreload" marker file next to the plugin.
  private async reloadWhenRebuilt(): Promise<void> {
    const { adapter } = this.app.vault;
    const dir = this.manifest.dir;
    if (!dir || !(await adapter.exists(`${dir}/.hotreload`))) return;
    const builtAt = async () => (await adapter.stat(`${dir}/main.js`))?.mtime ?? 0;
    const loadedBuild = await builtAt();

    this.registerInterval(
      window.setInterval(async () => {
        if ((await builtAt()) === loadedBuild) return;
        new Notice("Curious was updated. Reloading…");
        // Obsidian's plugin manager isn't in its public type definitions.
        const plugins = (this.app as unknown as { plugins: { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<void> } }).plugins;
        await plugins.disablePlugin(this.manifest.id);
        await plugins.enablePlugin(this.manifest.id);
      }, 2000),
    );
  }

  // ---- Commands -----------------------------------------------------------

  // Obsidian's Editor wraps a CodeMirror view; `cm` is how plugins reach it
  // (widely used, though not in Obsidian's type definitions).
  private cmView(editor: Editor): EditorView {
    return (editor as unknown as { cm: EditorView }).cm;
  }

  // Rather than grabbing the Enter key (Obsidian and other plugins may get to
  // it first), this watches every edit and reacts after the fact: if you just
  // typed a new line and the line above it is a command you've just written
  // or changed, run that command.
  private onEditorUpdate(update: ViewUpdate): void {
    if (!update.docChanged) return;
    if (!update.transactions.some((tr) => tr.isUserEvent("input"))) return; // only your typing
    let addedLine = false;
    update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (inserted.toString().includes("\n")) addedLine = true;
    });
    if (!addedLine) return;

    // The cursor should be on a fresh, empty line, below the line you just
    // finished: either a command, or ordinary writing (for auto-linking).
    const { doc, selection } = update.state;
    const cursorLine = doc.lineAt(selection.main.head);
    if (cursorLine.number < 2 || cursorLine.text.trim() !== "") return;
    const finished = doc.line(cursorLine.number - 1);
    const file = update.state.field(editorInfoField, false)?.file ?? null;

    if (!parseCommandLine(finished.text, this.settings.commandPrefix)) {
      this.autoLink(update.view, finished.from, finished.text, file);
      return;
    }
    // Already ran and unchanged since: Enter is just making room to write.
    if (!this.fresh.isFresh(update.state, finished.from)) return;
    // Changing the editor from inside an update isn't allowed, so do it right after.
    window.setTimeout(() => this.runCommand(update.view, finished.number, file));
  }

  // Turn concepts the open search linked into links in the line you just
  // wrote ("Figma Make" -> [Figma Make](url)). Your own note with that name
  // is used instead of the web page, and only the first mention in a note
  // gets a link.
  private autoLink(view: EditorView, lineStart: number, text: string, file: TFile | null): void {
    const active = this.activeSearch;
    if (!this.settings.autoLink || !active || !file || file.path !== active.filePath) return;
    const terms = active.state.turns.flatMap((turn) => turn.result.terms);
    if (terms.length === 0) return;

    const notesByName = new Map(this.app.vault.getMarkdownFiles().map((f) => [f.basename.toLowerCase(), f.basename]));
    const targets: LinkTarget[] = terms.map((t) => {
      const note = notesByName.get(t.term.toLowerCase());
      return note ? { term: t.term, note } : { term: t.term, url: t.url };
    });
    const noteText = view.state.doc.toString();
    const alreadyLinked = (target: LinkTarget) =>
      target.note !== undefined ? noteText.includes(`[[${target.note}`) : noteText.includes(`](${target.url})`);

    const { text: linkedText, linked } = linkLine(text, targets, alreadyLinked);
    if (linked.length === 0) return;

    // Changing the editor from inside an update isn't allowed, so do it right
    // after, and only if the line hasn't changed in the meantime.
    window.setTimeout(() => {
      if (!view.dom.isConnected || lineStart > view.state.doc.length) return;
      const line = view.state.doc.lineAt(lineStart);
      if (line.from !== lineStart || line.text !== text) return;
      view.dispatch({ changes: { from: line.from, to: line.to, insert: linkedText } });
      new Notice(`Linked ${linked.map((t) => `"${t.term}"`).join(", ")}. Ctrl+Z to undo.`);
    });
  }

  // Runs the command on line `lineNumber` (counting from 1), if there is one.
  // Returns whether it did.
  private runCommand(view: EditorView, lineNumber: number, file: TFile | null): boolean {
    const line = view.state.doc.line(lineNumber);
    const parsed = parseCommandLine(line.text, this.settings.commandPrefix);
    if (!parsed) return false;
    if (parsed.name === "commands" || parsed.name === "tag") {
      // Remove the line (with its line break) so nothing is left behind,
      // then open the pop-up.
      view.dispatch({ changes: { from: line.from, to: Math.min(line.to + 1, view.state.doc.length) } });
      if (parsed.name === "commands") this.showCommands();
      else if (file) this.suggestTagsFor(file);
      return true;
    }
    if (parsed.name === "search") {
      view.dispatch({ effects: markRan.of(line.from) });
      this.runSearch(view, line.text, parsed.arg, file);
      return true;
    }
    const handler = this.commands[parsed.name];
    if (!handler) {
      // Leave the note alone (it might just be text like "@todo: ..."), but
      // say so, rather than silently doing nothing.
      const p = this.settings.commandPrefix;
      const known = [...Object.keys(this.commands), "search", "tag", "commands"].map((name) => p + name).join(", ");
      new Notice(`Curious doesn't have ${p}${parsed.name} yet. Available: ${known}`);
      return false;
    }

    // Show a "Working…" box right away; you can keep writing meanwhile.
    view.dispatch({ effects: markRan.of(line.from) });
    const answer: Answer = {
      id: ++this.answerCount,
      command: parsed.name,
      title: parsed.arg,
      markdown: "",
      pending: true,
      sourcePath: file?.path ?? "",
    };
    this.answers.show(view, line.to, answer);

    handler(parsed.arg, file)
      .then((result) => ({ ...answer, title: result.title, markdown: result.lines.join("\n"), pending: false }))
      .catch((error) => {
        console.error("Curious:", error);
        return { ...answer, title: "Something went wrong", markdown: this.describeError(error), pending: false };
      })
      .then((done) => this.answers.update(view, done));
    return true;
  }

  private showCommands(): void {
    new CommandsModal(this.app, this.settings.commandPrefix).open();
  }

  // ---- Tags ---------------------------------------------------------------

  // Suggest tags for `file` in a pop-up; ticked ones go into its tags property.
  private suggestTagsFor(file: TFile): void {
    new TagModal(
      this.app,
      file.basename,
      async () => {
        const noteText = noteBody(await this.app.vault.cachedRead(file), this.settings.commandPrefix);
        await this.syncIndex();
        // Tags on the notes most like this one, so similar notes end up
        // tagged alike.
        const similar = await this.index.search(noteText.slice(0, 2000), 6, file.path).catch(() => []);
        return suggestTags(this.makeTagModel(), {
          noteName: file.basename,
          noteText,
          currentTags: this.tagsOf(file),
          vaultTags: countTags(this.app.vault.getMarkdownFiles().flatMap((f) => this.tagsOf(f))),
          similarNoteTags: countTags(
            similar.flatMap((hit) => {
              const note = this.app.vault.getFileByPath(hit.path);
              return note ? this.tagsOf(note) : [];
            }),
          ),
        });
      },
      async (tags) => {
        // Obsidian's standard place for tags: the note's "tags" property.
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          const existing = frontmatter.tags;
          const list: string[] = Array.isArray(existing)
            ? existing.map(String)
            : typeof existing === "string"
              ? existing.split(/[,\s]+/).filter(Boolean)
              : [];
          for (const tag of tags) if (!list.includes(tag)) list.push(tag);
          frontmatter.tags = list;
        });
        new Notice(`Added ${tags.length} tag${tags.length === 1 ? "" : "s"}: ${tags.map((t) => "#" + t).join(" ")}`);
      },
    ).open();
  }

  // Every tag on a note (in its properties or in the text), without "#".
  private tagsOf(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache ? [...new Set((getAllTags(cache) ?? []).map((t) => t.replace(/^#/, "")))] : [];
  }

  private makeTagModel(): LanguageModel {
    if (this.settings.tagModel === "local") {
      return new OllamaChatModel(this.ollamaPost, this.settings.ollamaUrl, this.settings.localModel);
    }
    return this.makeModel();
  }

  // ---- Shortcut hints -----------------------------------------------------

  // Count a use of a shortcut; after a few, its hint stops showing.
  private usedShortcut(id: string): void {
    const counts = this.settings.learnedShortcuts;
    if ((counts[id] ?? 0) >= LEARNED_AFTER) return;
    counts[id] = (counts[id] ?? 0) + 1;
    void this.saveAll();
    this.updateBrowserHint();
  }

  private isLearned(id: string): boolean {
    return (this.settings.learnedShortcuts[id] ?? 0) >= LEARNED_AFTER;
  }

  // Bring back every hint (from settings).
  async resetShortcutHints(): Promise<void> {
    this.settings.learnedShortcuts = {};
    await this.saveAll();
    this.updateBrowserHint();
  }

  updateBrowserHint(): void {
    const browserOpen = this.webLeaf() !== null;
    const inNote = this.app.workspace.getActiveViewOfType(MarkdownView) !== null;
    const down = hotkeyText(this.app, "browser-scroll-down");
    const up = hotkeyText(this.app, "browser-scroll-up");
    const show = this.settings.shortcutHints && browserOpen && inNote && down && up && !this.isLearned("browser-scroll");
    this.browserHint.setText(show ? `${down} / ${up} scroll the browser` : "");
    this.browserHint.toggle(Boolean(show));
  }

  // ---- Side browser -------------------------------------------------------

  // The web link the cursor or selection is on, if any.
  private linkUnderCursor(editor: Editor): string | null {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    // The whole lines the selection spans, so a link only partly selected
    // (or one the cursor merely sits in) is still found.
    const text = editor.getRange({ line: from.line, ch: 0 }, { line: to.line, ch: editor.getLine(to.line).length });
    const start = editor.posToOffset({ line: from.line, ch: 0 });
    return linkAt(text, editor.posToOffset(from) - start, editor.posToOffset(to) - start);
  }

  // Open `url` in the browser pane, to the right of the note. Reuses the
  // pane if it's already open.
  private async openBeside(url: string): Promise<void> {
    // PDFs go through the browser too: it reads the PDF's title (for a good
    // file name), then hands it to Obsidian's PDF viewer.
    const { workspace } = this.app;
    // The browser lives in the right sidebar, as a tab next to the chat.
    // (Older versions opened it beside the note; move it over.)
    let existing: WorkspaceLeaf | undefined = workspace.getLeavesOfType(BROWSER_VIEW)[0];
    if (existing && existing.getRoot() !== workspace.rightSplit) {
      existing.detach();
      existing = undefined;
    }
    const leaf = existing ?? workspace.getRightLeaf(false)!;
    await leaf.setViewState({ type: BROWSER_VIEW, active: true, state: { url } });
    await workspace.revealLeaf(leaf);
    // The page gets the keyboard, ready for f / j / k. Esc or Alt+O comes back.
    (leaf.view as BrowserView).focusPage();
  }

  // Over to the web page you were last on (browser or PDF), or ask for an
  // address if there isn't one.
  private async goToWeb(): Promise<void> {
    const leaf = this.webLeaf();
    if (!leaf) return this.askAddress();
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof BrowserView) leaf.view.focusPage();
    else this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  // The browser, or a PDF open in the right sidebar (where web PDFs go).
  private isWebLeaf(leaf: WorkspaceLeaf): boolean {
    const type = leaf.view.getViewType();
    return type === BROWSER_VIEW || (type === "pdf" && leaf.getRoot() === this.app.workspace.rightSplit);
  }

  // The web page you were last on, if one is still open.
  private webLeaf(): WorkspaceLeaf | null {
    const { workspace } = this.app;
    const open = [...workspace.getLeavesOfType(BROWSER_VIEW), ...workspace.getLeavesOfType("pdf")].filter((l) => this.isWebLeaf(l));
    if (this.lastWebLeaf && open.includes(this.lastWebLeaf)) return this.lastWebLeaf;
    return open[0] ?? null;
  }

  // A web page scrolls by most of a screen; a PDF turns a whole page.
  private scrollWeb(leaf: WorkspaceLeaf, screens: number): void {
    if (leaf.view instanceof BrowserView) return leaf.view.scrollPage(screens);
    turnPage(leaf.view, leaf.view.containerEl, screens > 0 ? 1 : -1);
  }

  // Once a web PDF has loaded: fit one whole page to the pane, and list its
  // keys at the bottom (once per tab).
  private async setUpPdf(leaf: WorkspaceLeaf): Promise<void> {
    const container = leaf.view.containerEl;
    // Only once per tab, so switching back doesn't undo your own zoom.
    if (container.querySelector(".curious-pdf-help")) return;
    const help = container.createDiv({ cls: "curious-browser-help curious-pdf-help" });
    help.createSpan({ cls: "curious-browser-help-label", text: "In the PDF:" });
    for (const [key, what] of [["j/k", "next/previous page"], ["Esc", "back to note"]]) {
      const item = help.createSpan();
      item.createEl("kbd", { text: key });
      item.appendText(" " + what);
    }
    const ready = await whenPdfReady(leaf.view);
    const fitted = ready && fitPage(leaf.view);
    debug("pdf set up", { ready, fitted });
  }

  // Zoom from the note works on the browser; a PDF has its own zoom buttons.
  private zoomWeb(leaf: WorkspaceLeaf, step: number): void {
    if (leaf.view instanceof BrowserView) leaf.view.zoomBy(step);
    else new Notice("Use the PDF's own + / − buttons at the top to zoom it.");
  }

  // A PDF from the web: save it into the vault and open it in Obsidian's
  // PDF viewer, as a tab in the side pane (see webPdf.ts for why).
  private async openPdf(url: string, title: string): Promise<void> {
    const notice = new Notice("Opening the PDF in Obsidian's PDF viewer…", 0);
    try {
      const file = await savePdf(this.app, url, title, this.settings.pdfFolder);
      const { workspace } = this.app;
      const existing = workspace.getLeavesOfType("pdf").find((l) => this.isWebLeaf(l));
      const leaf = existing ?? workspace.getRightLeaf(false)!;
      await leaf.openFile(file, { active: true });
      await workspace.revealLeaf(leaf);
      this.lastWebLeaf = leaf;
      workspace.setActiveLeaf(leaf, { focus: true });
      void this.setUpPdf(leaf);
      notice.setMessage(`Saved to "${file.path}". j / k turn pages (Alt+J / Alt+K from your note); Esc goes back.`);
    } catch (error) {
      console.error("Curious:", error);
      notice.setMessage(`Couldn't open the PDF: ${(error as Error)?.message ?? error}`);
    }
    window.setTimeout(() => notice.hide(), 6000);
  }

  private browser(): BrowserView | null {
    const leaf = this.app.workspace.getLeavesOfType(BROWSER_VIEW)[0];
    return leaf ? (leaf.view as BrowserView) : null;
  }

  // No browser open yet: ask for an address, then open it beside the note.
  private askAddress(): void {
    new AddressModal(this.app, "", (url) => void this.openBeside(url)).open();
  }

  // From the browser back to the note you were writing in.
  private backToWriting(): void {
    const notes = this.app.workspace.getLeavesOfType("markdown");
    // The last note you were in, if it's still open, or else any open note.
    const leaf = this.lastNoteLeaf && notes.includes(this.lastNoteLeaf) ? this.lastNoteLeaf : notes[0];
    if (!leaf) return;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    (leaf.view as { editor?: Editor }).editor?.focus();
  }

  // Zoom changes come in quick bursts (Ctrl+scroll), so save once they stop.
  private saveZoomSoon = debounce(() => this.saveAll(), 1000, true);

  // ---- Edits --------------------------------------------------------------

  // Ask Claude to edit the selected text. It's only replaced if you accept.
  private suggestEditsFor(editor: Editor, file: TFile | null): void {
    const selected = editor.getSelection();
    if (!selected.trim()) {
      new Notice("Select the text you want edited first.");
      return;
    }
    // Remember where the selection was, as character offsets into the note.
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    const full = editor.getValue();
    // Spaces and line breaks around the selection stay as they are, so
    // accepting doesn't glue the edit onto the next line.
    const lead = selected.match(/^s*/)![0];
    const trail = selected.match(/s*$/)![0];
    const original = selected.trim();

    new EditModal(this.app, original, {
      suggest: (instruction, previous) =>
        suggestEdit(this.makeModel(), {
          noteName: file?.basename ?? "Untitled",
          selection: original,
          instruction,
          before: full.slice(0, from),
          after: full.slice(to),
          previous,
        }),
      accept: (text) => {
        // You may have kept writing while Claude worked, so find the
        // selected text again rather than trusting the old position.
        const current = editor.getValue();
        let start = current.slice(from, to) === selected ? from : -1;
        if (start === -1) {
          const first = current.indexOf(selected);
          // Only if it's there exactly once, so the wrong copy isn't replaced.
          if (first !== -1 && current.indexOf(selected, first + 1) === -1) start = first;
        }
        if (start === -1) {
          new Notice("The selected text changed while Claude was working, so nothing was replaced.");
          return;
        }
        editor.replaceRange(lead + text + trail, editor.offsetToPos(start), editor.offsetToPos(start + selected.length));
        new Notice("Edit applied. Ctrl+Z to undo.");
      },
    }).open();
  }

  // ---- Search panel -------------------------------------------------------

  // A fresh, empty search. `commandText` is its "@search: ..." line, removed
  // when the search closes ("" when started from the panel, with no line).
  private newSearch(filePath: string, commandText: string, editorView: EditorView) {
    return {
      id: ++this.answerCount,
      filePath,
      commandText,
      editorView,
      state: { turns: [], pending: null, error: null, sourcePath: filePath, attachments: [] } as SearchState,
    };
  }

  private async runSearch(editorView: EditorView, commandText: string, query: string, file: TFile | null) {
    const filePath = file?.path ?? "";
    // A new search replaces the previous one, which counts as closing it.
    const previous = this.activeSearch;
    if (previous && !(previous.filePath === filePath && previous.commandText === commandText)) this.closeSearch(false);
    this.activeSearch = this.newSearch(filePath, commandText, editorView);

    await this.openSearchPanel();
    editorView.focus(); // keep typing in the note, not the panel
    await this.searchTurn(query);
  }

  // Attach the selected text (or the whole note, if nothing is selected) to
  // the search, like pasting it in, then jump to the box to ask about it.
  // Starts a new search in the panel if none is open.
  private async attachToSearch(editor: Editor, file: TFile | null): Promise<void> {
    const name = file?.basename ?? "this note";
    const selection = editor.getSelection();
    const text = selection || editor.getValue();
    if (!text.trim()) {
      new Notice("Nothing to attach: the note is empty.");
      return;
    }
    const lines = text.split("\n").length;
    const label = selection ? `Selection from ${name} · ${lines} line${lines === 1 ? "" : "s"}` : `${name} (whole note)`;

    if (!this.activeSearch) {
      this.activeSearch = this.newSearch(file?.path ?? "", "", this.cmView(editor));
    }
    this.activeSearch.state.attachments.push({ label, text });
    await this.focusFollowUp();
  }

  // Open the note picker to attach whole notes to the search. Starts a new
  // search if none is open. When the picker closes, you're back in the
  // follow-up box with your question as you left it.
  private async pickNotes(initialQuery = "", editor?: Editor, file?: TFile | null): Promise<void> {
    if (!this.activeSearch) {
      if (!editor) return;
      this.activeSearch = this.newSearch(file?.path ?? "", "", this.cmView(editor));
      await this.openSearchPanel();
      this.searchPanel()?.show({ ...this.activeSearch.state });
    }
    const active = this.activeSearch;
    const label = (picked: TFile) => picked.basename;
    const isAttached = (picked: TFile) => active.state.attachments.some((a) => a.label === label(picked));

    new NotePicker(
      this.app,
      {
        searchByMeaning: async (text) => {
          await this.syncIndex();
          return this.index.search(text, 8);
        },
        attach: async (picked) => {
          if (isAttached(picked)) return;
          const text = noteBody(await this.app.vault.cachedRead(picked), this.settings.commandPrefix);
          if (!text.trim()) return void new Notice(`"${picked.basename}" is empty.`);
          active.state.attachments.push({ label: label(picked), text });
          if (this.activeSearch === active) this.searchPanel()?.show({ ...active.state });
        },
        isAttached,
        onClose: () => this.searchPanel()?.focusInput(),
      },
      initialQuery,
    ).open();
  }

  private removeAttachment(index: number): void {
    const active = this.activeSearch;
    if (!active) return;
    active.state.attachments.splice(index, 1);
    this.searchPanel()?.show({ ...active.state });
  }

  // Answer one question in the open search: the first one, or a follow-up.
  private async searchTurn(query: string): Promise<void> {
    const active = this.activeSearch;
    if (!active || active.state.pending) return; // one question at a time
    const { state } = active;
    const show = () => {
      // Only if this search is still the one open (not closed or replaced).
      if (this.activeSearch === active) this.searchPanel()?.show({ ...state });
    };

    // Attachments go with this question, then stay part of the conversation.
    const attachments = state.attachments;
    state.attachments = [];
    state.pending = query;
    state.error = null;
    show();
    try {
      await this.syncIndex();
      const result = await search(this.index, this.makeModel(), query, state.sourcePath, state.turns, attachments);
      state.turns.push({ query, attachments, result });
    } catch (error) {
      console.error("Curious:", error);
      state.error = this.describeError(error);
      state.attachments = attachments; // give them back to try again
    }
    state.pending = null;
    show();
  }

  private searchPanel(): SearchPanel | null {
    const leaf = this.app.workspace.getLeavesOfType(SEARCH_VIEW)[0];
    return leaf ? (leaf.view as SearchPanel) : null;
  }

  // Jump from the note to the panel's follow-up box (keyboard).
  // No chat open yet: start an empty one, tied to the note you were in.
  private async focusFollowUp(): Promise<void> {
    if (!this.activeSearch) {
      const notes = this.app.workspace.getLeavesOfType("markdown");
      const leaf = this.lastNoteLeaf && notes.includes(this.lastNoteLeaf) ? this.lastNoteLeaf : notes[0];
      const note = leaf?.view instanceof MarkdownView ? leaf.view : null;
      if (!note) {
        new Notice("Open a note first, then press Alt+F to ask something.");
        return;
      }
      this.activeSearch = this.newSearch(note.file?.path ?? "", "", this.cmView(note.editor));
    }
    await this.openSearchPanel();
    const panel = this.searchPanel();
    panel?.show({ ...this.activeSearch.state }); // in case the panel had been closed
    panel?.focusInput();
  }

  // Back from the follow-up box to where you were writing.
  private backToNote(): void {
    const view = this.activeSearch?.editorView;
    if (view?.dom.isConnected) view.focus();
    else this.app.workspace.activeEditor?.editor?.focus();
  }

  private async openSearchPanel(): Promise<SearchPanel> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SEARCH_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: SEARCH_VIEW, active: false });
    }
    await workspace.revealLeaf(leaf);
    return leaf.view as SearchPanel;
  }

  // Close the side panel and remove the search's "@search: ..." line, so
  // only your own writing is left. Returns false if no search was open.
  // `detach`: also close the panel (not needed when a new search replaces it).
  private closeSearch(detach = true): boolean {
    const search = this.activeSearch;
    if (!search) return false;
    this.activeSearch = null;
    if (search.commandText) this.removeLine(search.filePath, search.commandText);
    if (detach) this.app.workspace.detachLeavesOfType(SEARCH_VIEW);
    return true;
  }

  // Delete the first line equal to `text` from the note at `path`. Uses the
  // open editor if there is one (so undo works), otherwise edits the file.
  private removeLine(path: string, text: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as { file?: TFile | null; editor?: Editor };
      if (view.file?.path !== path || !view.editor) continue;
      const editor = view.editor;
      for (let i = 0; i < editor.lineCount(); i++) {
        if (editor.getLine(i) !== text) continue;
        // Take the line break with it, so no empty line is left behind.
        if (i + 1 < editor.lineCount()) editor.replaceRange("", { line: i, ch: 0 }, { line: i + 1, ch: 0 });
        else if (i > 0) editor.replaceRange("", { line: i - 1, ch: editor.getLine(i - 1).length }, { line: i, ch: text.length });
        else editor.setLine(i, "");
        return;
      }
      return;
    }
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    this.app.vault.process(file, (content) => {
      const lines = content.split("\n");
      const i = lines.indexOf(text);
      if (i !== -1) lines.splice(i, 1);
      return lines.join("\n");
    });
  }

  private async readNote(path: string): Promise<string> {
    const note = this.app.vault.getFileByPath(path);
    return note ? this.app.vault.cachedRead(note) : "";
  }

  private describeError(error: unknown): string {
    const message = String((error as Error)?.message ?? error);
    if (/ECONNREFUSED|ERR_CONNECTION|Failed to fetch|net::/i.test(message)) {
      return `Couldn't reach Ollama at ${this.settings.ollamaUrl}. Is it running?`;
    }
    if (message.includes(this.settings.embedModel) && /not found/i.test(message)) {
      return `Ollama doesn't have "${this.settings.embedModel}". Run: ollama pull ${this.settings.embedModel}`;
    }
    return message;
  }

  // ---- Models -------------------------------------------------------------

  private makeModel(): ClaudeCodeModel {
    return new ClaudeCodeModel(this.settings.claudeCommand, this.settings.claudeModel);
  }

  // ---- Index --------------------------------------------------------------

  // requestUrl is Obsidian's way to make web requests without the browser
  // security rules (CORS) that would otherwise block calls to localhost.
  private ollamaPost = async (url: string, body: unknown) => {
    const response = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(body),
      throw: false,
    });
    if (response.status >= 400) throw new Error(response.json?.error ?? `HTTP ${response.status}`);
    return response.json;
  };

  private makeOllama(): OllamaClient {
    return new OllamaClient(this.ollamaPost, this.settings.ollamaUrl, this.settings.embedModel);
  }

  // Runs one sync at a time; a request during a sync queues one more after it.
  syncIndex(): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      do {
        this.syncAgain = false;
        await this.syncOnce();
      } while (this.syncAgain);
    })().finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async syncOnce(): Promise<void> {
    const notes: NoteSource[] = this.app.vault.getMarkdownFiles().map((file) => ({
      path: file.path,
      mtime: file.stat.mtime,
      read: () => this.app.vault.cachedRead(file),
    }));
    try {
      const changed = await this.index.sync(notes, (done, total) => {
        this.statusBar.setText(`Curious: indexing ${done}/${total}`);
      });
      if (changed > 0) await this.saveAll();
      this.statusBar.setText(`Curious: ${this.index.size} notes indexed`);
    } catch (error) {
      console.error("Curious: indexing failed", error);
      this.statusBar.setText("Curious: indexing paused (Ollama unreachable?)");
    }
  }

  private async rebuildIndex(): Promise<void> {
    await this.syncing;
    this.index = new NoteIndex(this.makeOllama(), {}, this.settings.commandPrefix);
    await this.syncIndex();
    new Notice(`Curious: indexed ${this.index.size} notes.`);
  }

  // ---- Saving -------------------------------------------------------------

  async saveSettings(options: { rebuildIndex?: boolean } = {}): Promise<void> {
    if (options.rebuildIndex) {
      await this.rebuildIndex();
    } else {
      // The address or symbol may have changed, so reconnect, keeping the index.
      this.index = new NoteIndex(this.makeOllama(), this.index.toJSON(), this.settings.commandPrefix);
    }
    await this.saveAll();
  }

  private async saveAll(): Promise<void> {
    const data: SavedData = { settings: this.settings, index: this.index.toJSON() };
    await this.saveData(data);
  }
}
