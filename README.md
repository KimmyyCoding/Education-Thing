# Curious

**An Obsidian plugin for learning through note-taking: the AI proposes, you do the thinking.**

Most people who study with ChatGPT or Claude ask a question, read the answer, and forget it. Curious puts the AI inside your notes instead, and it's built to hand the thinking back to you: it points you to what you've already written, asks you questions, and suggests changes for you to accept rather than writing your notes for you.

Status: early MVP (v0.17). Desktop only (Windows, Mac, Linux).

---

## What it does

Curious is built on a few rules:

- **Your notes only contain what you wrote.** AI answers appear in boxes and side panels that are never saved into the note.
- **The AI points and asks; you write.** `@recall` quotes your own notes instead of summarising them, `@ask` ends with a question for you, and edits and tags are only suggestions.
- **You choose what's sent.** `@recall` runs entirely on your computer. Claude only sees what a command needs, or what you attach.

### Commands you type in notes

Type a command on its own line and press **Enter**. Enter only runs a command you've just typed or changed. Pressing Enter on one that already ran just starts a new line, so old commands never fire again when you reopen a note.

| Command | What it does |
|---|---|
| `@recall: topic` | Finds what **you've already written** about a topic, searching by meaning rather than exact words. Each match is labelled (strong match / related / loose match) and quotes the passage that matched, in your own words. It never summarises, so you do the remembering. |
| `@ask: question` | Answers a question **from your own notes**, citing the notes it used as `[[links]]`. It ends with a "Your turn:" question for you to answer in your own words. |
| `@search: question` | Asks Claude anything, with web search, like a normal chat. The answer opens in a side panel (see below). None of your notes are sent unless you attach them. |
| `@tag` | Suggests tags for the current note (see below). |
| `@commands` | Opens a cheat sheet of every command and shortcut, including what each one sends where. |

**Answer boxes** (for `@recall` and `@ask`) appear under the command line while you keep writing. They're drawn on top of the note but aren't part of the file. Use **↻** to re-run a command (or **Alt+R** on its line). **Esc** closes the nearest box and **Alt+X** closes them all. Links inside boxes are clickable: `[[note links]]` open the note, and web links open in your browser.

### The search panel (`@search`)

Answers open in the right sidebar, so you can read on the right and write on the left.

- **Layout:** Each answer shows key points first. "More detail" sits below, "Sources" is folded, and "Your notes on this" lists notes you've already written on the topic (found locally).
- **Follow-ups:** Each answer ends with 3 "Go deeper" questions. Type your own follow-up in the box at the bottom, or type 1–3 to pick a suggestion. Claude remembers the earlier questions, so asking "why?" works. **Alt+F** jumps to the box from your note.
- **Attach your notes:** **Alt+A** attaches the selected text (or the whole note if nothing is selected). **Alt+N**, or typing `@recall:` in the box, opens a note picker that searches by name and by meaning. You can also write `question… @recall: topic` to attach matching notes and ask in one go. Claude is told to point out any mistakes in what you attach.
- **Step through answers:** Each question and its answer is a "chunk". Move between chunks with ↑ / ↓ in the empty box, or with **Alt+[** / **Alt+]** from your note.
- **Auto-linking:** Answers link key concepts, like [Figma Make](https://www.figma.com/make/). When you later type that term in your note, Curious turns it into the same link. If you have a note with that name, it links to `[[your note]]` instead. **Ctrl+Z** undoes it.
- **Closing:** **Esc** or × closes the panel *and removes the `@search:` line*, so only your writing is left.

### Suggest edits (select text, then **Alt+E**)

Type how the text should change, or press 1–4 for a ready-made instruction: *fix spelling and grammar*, *make it clearer*, *make it shorter*, or *check it's correct and fix mistakes*.

- **Preview:** You see the edit word by word, with removed words struck out and new ones highlighted. A list explains what changed and why, so you can learn from the edit.
- **Accept or retry:** Press Enter with the box empty to accept, or type feedback and press Enter to try again. Nothing changes until you accept, and **Ctrl+Z** undoes it.
- **Context:** Claude sees the text around your selection and keeps your links, tags and formatting.

You can also right-click and choose **Curious: suggest edits**.

### Tag suggestions (`@tag` or **Alt+T**)

A pop-up suggests 2–5 tags, each with a one-line reason.

- **Reuses your tags:** It prefers tags already in your vault and maps near-duplicates onto them (for example, "Valuations" becomes "valuation"). New tags are flagged, and nested tags like `finance/risk` are allowed.
- **Learns from similar notes:** It looks at how your most similar notes are tagged.
- **You choose:** ↑ / ↓ move, Space ticks a tag, Enter adds the ticked tags to the note's `tags` property, and Esc cancels.

### Side browser (**Alt+O**)

Read links without leaving Obsidian. The browser opens in the right sidebar, next to the search chat.

- **Open and switch:** Put the cursor on a link and press **Alt+O**, or right-click and choose **Curious: open link beside note**. Anywhere else, **Alt+O** jumps into the browser, and inside a page it takes you back to your note. With no browser open, it asks for an address or a search (DuckDuckGo).
- **Chat · Web switch:** **Alt+F** goes to the chat, **Alt+O** to the web, and **Esc** back to your note.
- **From your note:** **Alt+J** / **Alt+K** scroll the page and **Alt+=** / **Alt+-** zoom it, while your cursor stays in the note.
- **Inside the page:** **f** shows a letter on every link and button; type the letter to follow it. **j** / **k** scroll, **H** / **L** go back and forward, and **o** opens the address bar. The keys are listed at the bottom of the browser.
- **Toolbar:** back / forward / reload buttons, zoom, **Fit** (shrinks wide pages to fit the pane), and ↗ to open the page in your own browser. Zoom is remembered for each website.
- **PDFs:** PDFs are saved to a `Web PDFs/` folder in your vault and open in Obsidian's own PDF viewer. They fit one page to the pane, **j** / **k** (or **Alt+J** / **Alt+K**) turn pages, and you can link to them from your notes.

### Shortcut hints

When a shortcut would help, a small hint appears in the top-right corner of the note. For example, it shows "Alt+O open beside" when your cursor is on a link, and "Alt+E suggest edits · Alt+A ask in search" when you select text. Each hint stops showing after you've used its shortcut 3 times. If you rebind a key, the hint shows your key.

### All shortcuts

| Key | Action |
|---|---|
| Enter | Run the command on this line (only if it's new or changed) |
| Alt+R | Re-run the command on this line |
| Esc | Close the nearest answer box / search panel, or leave the browser |
| Alt+X | Close all answer boxes |
| Alt+C | Show all commands |
| Alt+F | Go to the search chat (follow up) |
| Alt+A | Attach the selection (or the whole note) to the search |
| Alt+N | Pick notes to attach to the search |
| Alt+[ / Alt+] | Previous / next answer in the search |
| Alt+E | Suggest edits to the selection |
| Alt+T | Suggest tags |
| Alt+O | Open link beside the note / switch to the browser and back |
| Alt+J / Alt+K | Scroll the browser (or turn PDF pages) |
| Alt+= / Alt+- | Zoom the browser |

You can change any of these in **Settings → Hotkeys** (search for "Curious"). Forgot one? Type `@commands` or press **Alt+C**.

---

## 1. Install the plugin

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [Release](../../releases).
2. In your vault, create the folder `.obsidian/plugins/curious/` and put the three files in it.
   (`.obsidian` is hidden. On Windows, turn on View → Show → Hidden items. On Mac, press Cmd+Shift+. in Finder.)
3. Restart Obsidian, then go to **Settings → Community plugins** and turn on **Curious**.
   If Obsidian asks, turn off Restricted mode first.

**Alternative:** install the **BRAT** community plugin and give it this repo's URL. BRAT installs Curious and keeps it updated.

## 2. What each feature needs

Curious uses two kinds of AI:

- **Ollama**: free and runs on your own computer. Your notes never leave your machine. Curious uses it to understand what your notes are about.
- **Claude Code**: uses **your own** Claude subscription, for answers that need a stronger model.

| Feature | Ollama | Claude Code |
|---|:-:|:-:|
| `@recall` | ✅ | |
| `@ask` | ✅ (finds the notes) | ✅ (writes the answer) |
| `@search` | optional (links your related notes) | ✅ |
| `@tag` | ✅ if set to "Local model" in settings | ✅ by default |
| Suggest edits | | ✅ |
| Side browser | | |

You don't need everything. With Ollama alone, you get `@recall` and local tagging.

## 3. Setting up Ollama (if you don't have it)

Ollama is a free program that runs AI models on your own computer.

1. **Download it** from <https://ollama.com/download> and run the installer.
   - **Windows / Mac:** after installing, Ollama runs in the background. Look for the llama icon in the system tray or menu bar.
   - **Linux:** run `curl -fsSL https://ollama.com/install.sh | sh`.
2. **Check that it's working.** Open a terminal (Windows: PowerShell; Mac: Terminal) and run:
   ```
   ollama --version
   ```
   If it prints a version number, Ollama is installed.
3. **Download the models** Curious uses:
   ```
   ollama pull nomic-embed-text
   ollama pull qwen2.5:3b
   ```
   - `nomic-embed-text` (~270 MB) is **required** for `@recall` and `@ask`.
   - `qwen2.5:3b` (~1.9 GB) is **optional**. You only need it for local tagging.
4. **Restart Obsidian.** Curious will start indexing your notes; watch the status bar at the bottom.
   The first index takes a few minutes on a big vault. After that it only processes notes that change.

You don't need to change any settings: Curious looks for Ollama at `http://localhost:11434`, which is Ollama's default.

**Hardware:** the embedding model runs on almost any computer. `qwen2.5:3b` works best with 8 GB+ of RAM; it still runs on older machines, just slower.

### Troubleshooting

| You see | Fix |
|---|---|
| `Couldn't reach Ollama at http://localhost:11434. Is it running?` | Open the Ollama app (or run `ollama serve` in a terminal) and try again. |
| `Ollama doesn't have "nomic-embed-text"` | Run `ollama pull nomic-embed-text`. |
| Status bar says `indexing paused (Ollama unreachable?)` | Start Ollama, then restart Obsidian. |
| `ollama` isn't recognised in the terminal | Close and reopen the terminal after installing. On Windows, sign out and back in if it still fails. |

## 4. Setting up Claude Code

Claude Code is how Curious talks to Claude. It uses your own Claude subscription, so there's no extra API cost.

1. Install Claude Code: <https://docs.claude.com/en/docs/claude-code/setup>
2. Open a terminal, run `claude`, and log in once.
3. Restart Obsidian.

Don't want your notes sent to Claude? Skip this step and switch tagging to **Local model** in Curious's settings. `@recall` works fully offline.

## 5. Try it

Open a note and type one of these on its own line, then press **Enter**:

```
@recall: something you've written about
@ask: a question your notes could answer
@commands
```

## Settings

In **Settings → Curious** you can change:

- **The command symbol** (default `@`).
- **Ollama:** its address and the embedding model.
- **How many results** `@recall` shows, and how many notes are sent per `@ask`.
- **The Claude model**, and where Claude Code is installed (if Curious can't find it).
- **Auto-linking:** whether search concepts are linked in your notes.
- **Tags:** whether they come from Claude or the local model, and which local model.
- **Web PDFs:** where they're saved.
- **Shortcut hints:** turn them off, or show learned hints again.

If you want to rebuild the note index from scratch, use **Ctrl+P → "Curious: Rebuild note index"**.

## Building from source

```
npm install
npm run build
```
