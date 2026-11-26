// The "Chat · Web" switch at the top of the side pane. The chat (@search)
// and the browser are tabs in the same place on the right, and this moves
// between them. From the keyboard: Alt+F chat, Alt+O web, Esc your note.

export type PaneName = "chat" | "web";

export interface SwitcherActions {
  switchTo: (pane: PaneName) => void;
  keyFor: (pane: PaneName) => string | null; // e.g. "Alt+F"
}

export function renderSwitcher(parent: HTMLElement, active: PaneName, actions: SwitcherActions): HTMLElement {
  const bar = parent.createDiv({ cls: "curious-switcher" });
  const tabs: [PaneName, string][] = [
    ["chat", "Chat"],
    ["web", "Web"],
  ];
  for (const [pane, label] of tabs) {
    const button = bar.createEl("button", { cls: "curious-switcher-tab" });
    if (pane === active) button.addClass("is-active");
    button.createSpan({ text: label });
    const key = actions.keyFor(pane);
    if (key) button.createEl("kbd", { text: key });
    button.addEventListener("click", () => actions.switchTo(pane));
  }
  bar.createDiv({ cls: "curious-switcher-hint" }).createEl("kbd", { text: "Esc" }).insertAdjacentText("afterend", " note");
  return bar;
}
