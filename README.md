# Curious

An Obsidian plugin for learning through note-taking: the AI proposes, you do the thinking.
You type commands straight into your notes, like `@recall: topic`, `@ask: question` or `@search: topic`, and press Enter.

Desktop only (Windows, Mac, Linux).

## 1. Install the plugin

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [Release](../../releases).
2. In your vault, create the folder `.obsidian/plugins/curious/` and put the three files in it.
   (`.obsidian` is hidden. On Windows, turn on View → Show → Hidden items. On Mac, press Cmd+Shift+. in Finder.)
3. Restart Obsidian, then go to **Settings → Community plugins** and turn on **Curious**.
   If Obsidian asks, turn off Restricted mode first.

Alternatively, install the **BRAT** community plugin and give it this repo's URL. BRAT installs Curious and keeps it updated.

## 2. What each feature needs

| Feature | Runs on | You need |
|---|---|---|
| `@recall`, `@search` | Ollama (local, free, private) | Ollama + `nomic-embed-text` |
| `@tag` with "Local model" picked in settings | Ollama | Ollama + `qwen2.5:3b` |
| `@ask`, edit suggestions, `@tag` (default) | Claude Code | Claude Code, logged in with your own Claude plan |

You don't need everything. Set up only the parts you want to use.

## 3. Setting up Ollama (if you don't have it)

Ollama is a free program that runs AI models on your own computer. None of your notes leave your machine.

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
   `nomic-embed-text` is about 270 MB and needed for `@recall` and `@search`.
   `qwen2.5:3b` is about 1.9 GB and only needed if you want local tagging.
4. **Restart Obsidian.** Curious will start indexing your notes; watch the status bar at the bottom.
   The first index takes a few minutes on a big vault. After that it only processes notes that change.

You don't need to change any settings: Curious looks for Ollama at `http://localhost:11434`, which is Ollama's default.

**Hardware:** the embedding model runs on almost any computer. `qwen2.5:3b` works best with 8 GB+ of RAM; it still runs on older machines, just slower.

### Troubleshooting

| You see | Fix |
|---|---|
| `Couldn't reach Ollama at http://localhost:11434. Is it running?` | Open the Ollama app (or run `ollama serve` in a terminal) and try again. |
| `Ollama doesn't have "nomic-embed-text"` | Run `ollama pull nomic-embed-text`. |
| Status bar says `indexing paused (Ollama unreachable?)` | Same as above. Start Ollama, then restart Obsidian. |
| `ollama` isn't recognised in the terminal | Close and reopen the terminal after installing. On Windows, sign out and back in if it still fails. |

## 4. Setting up Claude Code (for `@ask`)

`@ask` sends your question and relevant notes to Claude through Claude Code, using **your own** Claude subscription.

1. Install Claude Code: <https://docs.claude.com/en/docs/claude-code/setup>
2. Open a terminal, run `claude`, and log in once.
3. Restart Obsidian.

Don't want to send notes to Claude? Skip this step. `@recall` and `@search` still work with Ollama alone, and in settings you can switch tagging to **Local model**.

## Building from source

```
npm install
npm run build
```
