// Makes links clickable inside Curious's own boxes and panel. Obsidian only
// wires up links inside note views, so Markdown rendered anywhere else needs
// this: [[note links]] open the note, web links open in your browser.

import { App } from "obsidian";

export function wireLinks(app: App, el: HTMLElement, sourcePath: string): void {
  el.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest("a");
    if (!link) return;
    event.preventDefault();
    if (link.hasClass("internal-link")) {
      // Ctrl+click opens the note in a new tab, as elsewhere in Obsidian.
      app.workspace.openLinkText(link.getAttribute("data-href") ?? "", sourcePath, event.ctrlKey || event.metaKey);
    } else if (link.href) {
      window.open(link.href); // Obsidian sends this to the default browser
    }
  });
}
