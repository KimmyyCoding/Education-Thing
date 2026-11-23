import { Notice, Plugin } from "obsidian";

export default class CuriousPlugin extends Plugin {
  // Obsidian calls onload() once, when the plugin is enabled.
  // Everything the plugin offers (commands, panels, settings) is registered here.
  async onload() {
    this.addCommand({
      id: "say-hello",
      name: "Say hello",
      callback: () => {
        new Notice("Curious is loaded.");
      },
    });

    // YOUR TURN (milestone 0):
    // Add a second command, "Count notes", that shows a Notice like
    // "This vault has 8 notes."
    //
    // Hint: this.app.vault.getMarkdownFiles() returns an array of every
    // markdown file in the vault.
  }

  // Called when the plugin is disabled. Commands registered with addCommand
  // are removed automatically, so there is nothing to clean up yet.
  onunload() {}
}
