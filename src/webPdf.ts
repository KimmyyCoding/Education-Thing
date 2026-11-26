// PDFs from the web, opened in Obsidian's own PDF viewer instead of the
// side browser. Inside the browser, a PDF is shown by Chromium's built-in
// viewer, which is sealed off from the page: Curious's keys (f, j/k, Esc,
// Alt+O) and zoom can't reach it. Obsidian's viewer is part of Obsidian, so
// every Curious shortcut works there, and you can link to a page of the PDF
// from your notes.
//
// Obsidian only shows files in the vault, so the PDF is saved into a folder
// (Settings → Curious → "Save web PDFs to"). A PDF that's already been saved
// isn't downloaded again.

import { App, normalizePath, requestUrl, TFile } from "obsidian";

// Save the PDF at `url` into `folder` and return the file. `title` (the
// PDF's own title, if the browser showed one) makes a better file name than
// addresses like ".../4bb8d08a9b30.pdf".
export async function savePdf(app: App, url: string, title: string, folder: string): Promise<TFile> {
  const path = normalizePath(`${folder}/${fileName(url, title)}`);
  const existing = app.vault.getFileByPath(path);
  if (existing) return existing; // saved before

  const response = await requestUrl({ url });
  const data = response.arrayBuffer;
  // Every PDF starts with "%PDF"; anything else is probably an error page.
  const start = new TextDecoder().decode(new Uint8Array(data.slice(0, 5)));
  if (!start.startsWith("%PDF")) throw new Error("The address didn't return a PDF.");

  if (!app.vault.getFolderByPath(normalizePath(folder))) await app.vault.createFolder(normalizePath(folder));
  return app.vault.createBinary(path, data);
}

function fileName(url: string, title: string): string {
  let base = "";
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").replace(/\.pdf$/i, "");
  } catch {
    // fall through to the title
  }
  // Prefer the title when the address's name is just letters and numbers
  // with no words in it (like a long code), or missing.
  const meaningless = !base || /^[0-9a-f-]{12,}$/i.test(base) || !/[a-z]{3}/i.test(base);
  const cleanTitle = title && !title.includes("/") ? title : "";
  const name = (meaningless && cleanTitle ? cleanTitle : base || cleanTitle || "Web PDF")
    // Characters that aren't allowed in file names, or mean something in links.
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${name || "Web PDF"}.pdf`;
}

// The part of a view that scrolls (the PDF's pages), so Alt+J / Alt+K can
// scroll it from your note.
export function scrollableIn(root: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestArea = 0;
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.scrollHeight <= el.clientHeight + 10) return;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") return;
    const area = el.clientWidth * el.clientHeight;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  });
  return best;
}

// ---- Fitting and turning pages ----
//
// Obsidian's PDF viewer is built on pdf.js (Mozilla's PDF reader). Its
// pdf.js object isn't part of Obsidian's public API, so this looks for it
// carefully, and falls back to scrolling the pages directly.

interface PdfJsViewer {
  currentScaleValue: string; // "page-fit" = one whole page fits the pane
  currentPageNumber: number;
  pagesCount: number;
}

function pdfJs(view: unknown): PdfJsViewer | null {
  const v = view as { viewer?: { child?: { pdfViewer?: { pdfViewer?: unknown } & object } } };
  const candidates = [v.viewer?.child?.pdfViewer?.pdfViewer, v.viewer?.child?.pdfViewer];
  for (const c of candidates) {
    const viewer = c as PdfJsViewer | undefined;
    if (viewer && typeof viewer.currentPageNumber === "number" && "currentScaleValue" in viewer) return viewer;
  }
  return null;
}

// Wait (up to `ms`) until the PDF has loaded its pages.
export async function whenPdfReady(view: unknown, ms = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if ((pdfJs(view)?.pagesCount ?? 0) > 0) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  return false;
}

// Zoom so one whole page fits the pane (its width and height both). Returns
// whether it could.
export function fitPage(view: unknown): boolean {
  const viewer = pdfJs(view);
  if (!viewer) return false;
  viewer.currentScaleValue = "page-fit";
  return true;
}

export function isFitted(view: unknown): boolean {
  return pdfJs(view)?.currentScaleValue === "page-fit";
}

// Jump to the next (+1) or previous (-1) page, lined up at the top.
export function turnPage(view: unknown, containerEl: HTMLElement, step: number): void {
  const viewer = pdfJs(view);
  if (viewer && viewer.pagesCount > 0) {
    viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, viewer.currentPageNumber + step));
    return;
  }
  // Fallback: find the page at the top of the view and scroll to its neighbour.
  const scroller = scrollableIn(containerEl);
  if (!scroller) return;
  const pages = [...scroller.querySelectorAll<HTMLElement>(".page")];
  const top = scroller.getBoundingClientRect().top;
  const current = Math.max(0, pages.findIndex((p) => p.getBoundingClientRect().bottom > top + 20));
  const target = pages[Math.max(0, Math.min(pages.length - 1, current + step))];
  if (target) scroller.scrollBy({ top: target.getBoundingClientRect().top - top, behavior: "smooth" });
}
