import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_PREFIX } from "./core/commands";
import type CuriousPlugin from "./main";

export interface CuriousSettings {
  commandPrefix: string;
  ollamaUrl: string;
  embedModel: string;
  recallLimit: number;
  claudeCommand: string;
  claudeModel: string;
  askSources: number;
  autoLink: boolean;
  tagModel: "claude" | "local";
  localModel: string;
  browserZoom: Record<string, number>; // zoom per website in the side browser
  shortcutHints: boolean;
  pdfFolder: string; // where PDFs opened from the web are saved
  learnedShortcuts: Record<string, number>; // times each hinted shortcut was used
}

export const DEFAULT_SETTINGS: CuriousSettings = {
  commandPrefix: DEFAULT_PREFIX,
  ollamaUrl: "http://localhost:11434",
  embedModel: "nomic-embed-text",
  recallLimit: 5,
  claudeCommand: "claude",
  claudeModel: "sonnet",
  askSources: 4,
  autoLink: true,
  tagModel: "claude",
  localModel: "qwen2.5:3b",
  browserZoom: {},
  shortcutHints: true,
  pdfFolder: "Web PDFs",
  learnedShortcuts: {},
};

export class CuriousSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CuriousPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Command symbol")
      .setDesc('What starts a command, e.g. "@" for "@recall: topic". Avoid "#", which Obsidian uses for tags.')
      .addText((text) =>
        text.setValue(this.plugin.settings.commandPrefix).onChange(async (value) => {
          if (!value.trim()) return;
          this.plugin.settings.commandPrefix = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Ollama address")
      .setDesc("Where Ollama is running. Leave as is unless you changed it.")
      .addText((text) =>
        text.setValue(this.plugin.settings.ollamaUrl).onChange(async (value) => {
          this.plugin.settings.ollamaUrl = value.trim().replace(/\/$/, "");
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc("Changing this rebuilds the note index.")
      .addText((text) =>
        text.setValue(this.plugin.settings.embedModel).onChange(async (value) => {
          this.plugin.settings.embedModel = value.trim();
          await this.plugin.saveSettings({ rebuildIndex: true });
        }),
      );

    new Setting(containerEl)
      .setName("Recall results")
      .setDesc("How many notes the recall command lists.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 15, 1)
          .setValue(this.plugin.settings.recallLimit)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.recallLimit = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Ask and search")
      .setHeading()
      .setDesc(
        "Both use Claude through Claude Code and your own Claude plan. " +
          "Ask sends your question plus excerpts of your most relevant notes to Anthropic. " +
          "Search sends only your question, and Claude may look it up on the web. Recall stays on this computer.",
      );

    new Setting(containerEl)
      .setName("Claude model")
      .setDesc('"sonnet" is plenty for answering from notes and uses less of your plan than "opus".')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ haiku: "Haiku (fastest)", sonnet: "Sonnet", opus: "Opus (strongest)" })
          .setValue(this.plugin.settings.claudeModel)
          .onChange(async (value) => {
            this.plugin.settings.claudeModel = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Notes sent per question")
      .setDesc("How many of your most relevant notes Claude gets to answer from.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 8, 1)
          .setValue(this.plugin.settings.askSources)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.askSources = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto-link concepts from search")
      .setDesc(
        "While a search is open, concepts its answer linked (like Figma Make) become links when you write them in that note. " +
          "Your own note with the same name is used instead of the web page. Only the first mention is linked. Ctrl+Z undoes it.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoLink).onChange(async (value) => {
          this.plugin.settings.autoLink = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Tags")
      .setHeading()
      .setDesc("@tag (or Alt+T) suggests tags for the current note. Nothing is added until you confirm.");

    new Setting(containerEl)
      .setName("Tag suggestions from")
      .setDesc(
        "Claude gives cleaner, more reusable tags, but gets the note's text. The local model is free and private, but its tags are less consistent.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ claude: "Claude (your plan)", local: "Local model (Ollama)" })
          .setValue(this.plugin.settings.tagModel)
          .onChange(async (value) => {
            this.plugin.settings.tagModel = value as "claude" | "local";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Local model")
      .setDesc("The Ollama model used when tags come from the local model.")
      .addText((text) =>
        text.setValue(this.plugin.settings.localModel).onChange(async (value) => {
          this.plugin.settings.localModel = value.trim() || "qwen2.5:3b";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Save web PDFs to")
      .setDesc("PDFs you open from a link are saved in this folder and shown in Obsidian's PDF viewer, where Curious's keys and zoom work.")
      .addText((text) =>
        text.setValue(this.plugin.settings.pdfFolder).onChange(async (value) => {
          this.plugin.settings.pdfFolder = value.trim() || "Web PDFs";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Shortcut hints")
      .setDesc(
        "Suggests a shortcut when it would help, like Alt+O to open a link beside your note when the cursor is on one. " +
          "Each hint goes away after you have used its shortcut 3 times.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.shortcutHints).onChange(async (value) => {
          this.plugin.settings.shortcutHints = value;
          await this.plugin.saveSettings();
          this.plugin.updateBrowserHint();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Show all hints again").onClick(async () => {
          await this.plugin.resetShortcutHints();
          button.setButtonText("Done");
        }),
      );

    new Setting(containerEl)
      .setName("Claude Code location")
      .setDesc('Leave as "claude" unless Curious says it can\'t find Claude Code.')
      .addText((text) =>
        text.setValue(this.plugin.settings.claudeCommand).onChange(async (value) => {
          this.plugin.settings.claudeCommand = value.trim() || "claude";
          await this.plugin.saveSettings();
        }),
      );
  }
}
