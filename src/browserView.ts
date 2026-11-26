// A small web browser in a pane next to your note, for reading a link
// without leaving Obsidian. Zoom with − / + (or Ctrl+scroll, Ctrl+= / Ctrl+-,
// Ctrl+0 inside the page). "Fit" shrinks a page that's wider than the pane
// so it fits. Zoom is remembered for each website.
//
// Made to work from the keyboard: Alt+O moves between the note and the page,
// Alt+J / Alt+K scroll the page while you stay in your note, and inside the
// page there are Vimium-style keys (see browserPage.ts).
//
// The page lives in Electron's <webview>, a browser tab that can be put
// inside an app's window (Obsidian's own Web Viewer uses the same thing).

import { App, ItemView, Modal, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { PAGE_SCRIPT } from "./browserPage";
import { renderSwitcher, SwitcherActions } from "./paneSwitcher";

export const BROWSER_VIEW = "curious-browser";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const STEP = 0.1;

// The parts of Electron's <webview> used here (not in Obsidian's types).
interface WebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  setZoomFactor(factor: number): void;
  executeJavaScript(code: string): Promise<unknown>;
}

export interface BrowserActions {
  zoomFor: (site: string) => number | undefined; // remembered zoom, if any
  saveZoom: (site: string, zoom: number) => void;
  toNote: () => void; // put the cursor back in the note you were writing
  switcher: SwitcherActions; // the Chat · Web switch at the top
  openPdf: (url: string, title: string) => void; // in Obsidian's PDF viewer instead
}

// The page's keys, always listed at the bottom of the pane.
const KEY_HELP: [string, string][] = [
  ["f", "links"],
  ["j/k", "scroll"],
  ["H/L", "back/forward"],
  ["o", "address"],
];

// Turns what you type in the address box into a web address: an address
// stays as it is, anything else becomes a web search.
export function toAddress(text: string): string {
  const typed = text.trim();
  if (/^https?:\/\//i.test(typed)) return typed;
  if (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(typed)) return "https://" + typed;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(typed);
}

// Type an address or a search, then Enter.
export class AddressModal extends Modal {
  constructor(
    app: App,
    private initial: string,
    private go: (url: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Open address or search");
    const input = this.contentEl.createEl("input", {
      type: "text",
      cls: "curious-browser-address",
      attr: { placeholder: "An address (example.com) or what to search for" },
    });
    input.value = this.initial;
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || !input.value.trim()) return;
      event.preventDefault();
      this.close();
      this.go(toAddress(input.value));
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// TEMPORARY (debugging "browser controls don't work"): writes what the
// pane does to debug-browser.log in the plugin folder. Remove once fixed.
let debugWrite: ((line: string) => void) | null = null;
export function setBrowserDebug(write: (line: string) => void): void {
  debugWrite = write;
}
export function debug(...parts: unknown[]): void {
  const line = new Date().toISOString().slice(11, 23) + " " + parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  console.log("Curious browser:", line);
  debugWrite?.(line);
}

export class BrowserView extends ItemView {
  private url = "";
  private webview: WebviewElement | null = null;
  private zoom = 1;
  private ready = false; // the webview only takes commands once loaded
  private titleEl!: HTMLElement;
  private zoomEl!: HTMLElement;
  private backButton!: HTMLButtonElement;
  private forwardButton!: HTMLButtonElement;

  constructor(
    leaf: WorkspaceLeaf,
    private actions: BrowserActions,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return BROWSER_VIEW;
  }

  getDisplayText(): string {
    if (this.currentUrl() === "about:blank") return "Browser";
    return this.webview?.getTitle?.() || this.site() || "Browser";
  }

  getIcon(): string {
    return "globe";
  }

  // Obsidian saves this with the layout, so the page reopens after a restart.
  getState(): Record<string, unknown> {
    return { url: this.currentUrl() };
  }

  async setState(state: { url?: string }, result: ViewStateResult): Promise<void> {
    if (state.url && state.url !== this.currentUrl()) this.navigate(state.url);
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("curious-browser");

    renderSwitcher(contentEl, "web", this.actions.switcher);
    const bar = contentEl.createDiv({ cls: "curious-browser-bar" });
    this.backButton = this.button(bar, "←", "Back", () => this.webview?.goBack());
    this.forwardButton = this.button(bar, "→", "Forward", () => this.webview?.goForward());
    this.button(bar, "↻", "Reload", () => this.webview?.reload());
    this.titleEl = bar.createDiv({ cls: "curious-browser-title" });
    this.button(bar, "−", "Zoom out (Ctrl+scroll in the page)", () => this.setZoom(this.zoom - STEP));
    this.zoomEl = bar.createEl("button", { cls: "curious-browser-zoom", attr: { "aria-label": "Reset zoom to 100%" } });
    this.zoomEl.addEventListener("click", () => this.setZoom(1));
    this.button(bar, "+", "Zoom in", () => this.setZoom(this.zoom + STEP));
    this.button(bar, "Fit", "Shrink the page to fit the pane's width", () => this.fit());
    this.button(bar, "↗", "Open in your browser", () => window.open(this.currentUrl()));
    this.updateBar();
    const help = contentEl.createDiv({ cls: "curious-browser-help" });
    help.createSpan({ cls: "curious-browser-help-label", text: "In the page:" });
    for (const [key, what] of KEY_HELP) {
      const item = help.createSpan({ cls: "curious-browser-help-item" });
      item.createEl("kbd", { text: key });
      item.appendText(" " + what);
    }

    if (this.url) this.navigate(this.url);
  }

  async onClose(): Promise<void> {
    this.webview = null;
  }

  // Show `url` in the pane.
  navigate(url: string): void {
    this.url = url;
    if (!this.titleEl) return; // not open yet; onOpen shows it
    if (this.webview) {
      this.webview.src = url;
      return;
    }
    const webview = document.createElement("webview") as WebviewElement;
    webview.addClass("curious-browser-page");
    webview.setAttribute("src", url);
    this.webview = webview;
    // Above the key list.
    this.contentEl.insertBefore(webview, this.contentEl.querySelector(".curious-browser-help"));
    webview.addEventListener("focus", () => this.contentEl.addClass("is-focused"));
    webview.addEventListener("blur", () => this.contentEl.removeClass("is-focused"));

    debug("create webview", url, { inSidebar: this.leaf.getRoot() === this.app.workspace.rightSplit });
    webview.addEventListener("dom-ready", () => {
      this.ready = true;
      const rect = webview.getBoundingClientRect();
      debug("dom-ready", webview.getURL(), { width: rect.width, height: rect.height });
      void webview
        .executeJavaScript(PAGE_SCRIPT)
        .then(() => webview.executeJavaScript("typeof window.__curiousScroll"))
        .then((result) => debug("page script injected; __curiousScroll is", result))
        .catch((error) => debug("page script failed", String(error)));
      // A PDF: Chromium's PDF viewer is sealed off from Curious's keys, so
      // hand it to Obsidian's viewer and step this pane back.
      void webview
        .executeJavaScript("document.contentType")
        .then(async (type) => {
          if (type !== "application/pdf") return;
          debug("pdf detected", webview.getURL());
          const url = webview.getURL();
          this.actions.openPdf(url, await this.pdfTitle(webview));
          if (webview.canGoBack()) webview.goBack();
          else this.navigate("about:blank");
        })
        .catch(() => {});
      this.applySiteZoom();
      this.updateBar();
    });
    webview.addEventListener("did-navigate", () => this.updateBar());
    webview.addEventListener("did-navigate-in-page", () => this.updateBar());
    webview.addEventListener("page-title-updated", () => this.updateBar());
    webview.addEventListener("did-fail-load", (event) => {
      const { errorCode, errorDescription, isMainFrame } = event as unknown as {
        errorCode: number;
        errorDescription: string;
        isMainFrame: boolean;
      };
      // -3 means the load was replaced by another one, which is normal.
      if (isMainFrame && errorCode !== -3) new Notice(`Couldn't load the page: ${errorDescription}`);
    });
    webview.addEventListener("focus", () => debug("webview focus"));
    webview.addEventListener("blur", () => debug("webview blur"));
    webview.addEventListener("console-message", (event) => {
      const message = (event as unknown as { message: string }).message;
      if (typeof message !== "string" || message.startsWith("__curious:")) {
        debug("console-message", { message, keys: Object.keys(event), level: (event as unknown as { level: unknown }).level });
      }
      if (message?.startsWith("__curious:")) this.fromPage(message.slice("__curious:".length));
    });
  }

  // A PDF's real title ("The Design of Everyday Things") only arrives once
  // Chromium has read the file; until then the title is just its address.
  // Wait up to 3 seconds for it, for a better file name. "" if none comes.
  private pdfTitle(webview: WebviewElement): Promise<string> {
    const real = (title: string) => (title && !title.includes("/") && !/\.pdf$/i.test(title) ? title : "");
    return new Promise((resolve) => {
      if (real(webview.getTitle())) return resolve(real(webview.getTitle()));
      const done = (title: string) => {
        window.clearTimeout(timer);
        webview.removeEventListener("page-title-updated", onTitle);
        debug("pdf title", title);
        resolve(title);
      };
      const onTitle = () => {
        if (real(webview.getTitle())) done(real(webview.getTitle()));
      };
      const timer = window.setTimeout(() => done(""), 3000);
      webview.addEventListener("page-title-updated", onTitle);
    });
  }

  // Something the page's keys asked for (see browserPage.ts).
  private fromPage(what: string): void {
    const webview = this.webview;
    if (!webview) return;
    if (what === "zoom-in") this.zoomBy(STEP);
    else if (what === "zoom-out") this.zoomBy(-STEP);
    else if (what === "zoom-reset") this.setZoom(1);
    else if (what === "back" && webview.canGoBack()) webview.goBack();
    else if (what === "forward" && webview.canGoForward()) webview.goForward();
    else if (what === "reload") webview.reload();
    else if (what === "to-note") this.actions.toNote();
    else if (what === "to-chat") this.actions.switcher.switchTo("chat");
    else if (what === "address") this.askAddress();
  }

  // ---- Used by Curious's hotkeys, from the note ----

  // Give the page the keyboard, so its keys (f, j/k, …) work.
  focusPage(): void {
    debug("focusPage", { hasWebview: !!this.webview, ready: this.ready });
    this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
    this.webview?.focus();
  }

  // Scroll the page by a number of screens without leaving the note.
  scrollPage(screens: number): void {
    debug("scrollPage", screens, { ready: this.ready });
    if (!this.webview || !this.ready) return;
    const code = `window.__curiousScroll && window.__curiousScroll(${screens})`;
    void this.webview.executeJavaScript(code).catch(() => {});
  }

  zoomBy(step: number): void {
    this.setZoom(this.zoom + step);
  }

  // Type an address or search; the current address is filled in to edit.
  askAddress(): void {
    new AddressModal(this.app, this.currentUrl(), (url) => {
      this.navigate(url);
      this.focusPage();
    }).open();
  }

  private setZoom(zoom: number, remember = true): void {
    this.zoom = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100;
    debug("setZoom", this.zoom, { ready: this.ready });
    if (this.webview && this.ready) {
      try {
        this.webview.setZoomFactor(this.zoom);
      } catch (error) {
        debug("setZoomFactor error", String(error));
      }
    }
    if (remember && this.site()) this.actions.saveZoom(this.site(), this.zoom);
    this.updateBar();
  }

  // Each site opens at the zoom you last used on it.
  private applySiteZoom(): void {
    this.setZoom(this.actions.zoomFor(this.site()) ?? 1, false);
  }

  // If the page is wider than the pane (you'd have to scroll sideways),
  // zoom out until it fits.
  private async fit(): Promise<void> {
    if (!this.webview || !this.ready) return;
    // Both widths in the page's own pixels, which already account for zoom.
    const widths = (await this.webview
      .executeJavaScript("[document.documentElement.scrollWidth, window.innerWidth]")
      .catch(() => null)) as [number, number] | null;
    if (!widths) return;
    const [pageWidth, visibleWidth] = widths;
    if (pageWidth <= visibleWidth + 1) {
      new Notice("The page already fits the pane. Use − / + to change the size.");
      return;
    }
    this.setZoom(Math.floor(((this.zoom * visibleWidth) / pageWidth) * 100) / 100);
  }

  private updateBar(): void {
    if (!this.titleEl) return;
    const loaded = this.webview && this.ready;
    this.titleEl.setText(this.getDisplayText());
    this.titleEl.setAttr("title", this.currentUrl());
    this.zoomEl.setText(`${Math.round(this.zoom * 100)}%`);
    this.backButton.disabled = !loaded || !this.webview!.canGoBack();
    this.forwardButton.disabled = !loaded || !this.webview!.canGoForward();
    // The tab's name follows the page title.
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
  }

  private currentUrl(): string {
    return (this.webview && this.ready && this.webview.getURL()) || this.url;
  }

  private site(): string {
    try {
      return new URL(this.currentUrl()).hostname;
    } catch {
      return "";
    }
  }

  private button(bar: HTMLElement, text: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = bar.createEl("button", { text, attr: { "aria-label": label } });
    button.addEventListener("click", () => {
      debug("button", text, { ready: this.ready, hasWebview: !!this.webview, disabled: button.disabled });
      try {
        onClick();
      } catch (error) {
        debug("button error", text, String(error));
      }
    });
    return button;
  }
}
