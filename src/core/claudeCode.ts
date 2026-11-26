// Uses Claude through Claude Code, the command-line tool that comes with a
// Claude Pro/Max plan. Each question runs `claude -p` once, so it goes
// through the user's own login: no API key, no separate billing.
//
// Needs Node (to start a program), so it works in Obsidian on desktop or a
// future desktop app, but not on mobile or in a browser.

import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { CompleteOptions, LanguageModel } from "./llm";

const TIMEOUT_MS = 120_000;

export class ClaudeCodeModel implements LanguageModel {
  constructor(
    private command: string, // "claude", or a full path to it
    private model: string, // e.g. "sonnet"
  ) {}

  async complete(system: string, prompt: string, options: CompleteOptions = {}): Promise<string> {
    // No tools at all, or only web search (pre-approved, since there's no
    // one around to click "allow" in print mode).
    const tools = options.webSearch ? ["--tools", "WebSearch", "--allowedTools", "WebSearch"] : ["--tools", ""];
    const args = [
      "-p", // print mode: one question, one answer, then exit
      "--output-format", "json",
      "--model", this.model,
      // Replace Claude Code's own (long) instructions with ours, and switch
      // off everything it doesn't need here. This keeps each question small,
      // which matters because it counts against the plan's usage limits.
      "--system-prompt", system,
      ...tools,
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
    ];
    const stdout = await run(this.resolveCommand(), args, prompt);

    let response: { result?: string; is_error?: boolean };
    try {
      response = JSON.parse(stdout);
    } catch {
      throw new Error(`Unexpected reply from Claude Code: ${stdout.slice(0, 200)}`);
    }
    if (response.is_error || typeof response.result !== "string") {
      throw new Error(response.result || "Claude Code returned an error.");
    }
    return response.result;
  }

  // Apps started from the Start menu don't always see the same PATH as a
  // terminal, so fall back to where the Claude Code installer puts it.
  private resolveCommand(): string {
    if (this.command !== "claude") return this.command;
    const installed = join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
    return existsSync(installed) ? installed : "claude";
  }
}

function run(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Run from the temp folder so Claude Code doesn't pick up any project
    // instructions from wherever Obsidian happens to be.
    const child = spawn(command, args, { cwd: tmpdir(), windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Claude took too long to answer (2 minutes)."));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? new Error("Couldn't find Claude Code. Set its location in Curious settings.")
          : error,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // With --output-format json, errors like "not logged in" still arrive
      // on stdout as JSON, so only fail here if there's nothing to read.
      if (code !== 0 && !stdout.trim()) reject(new Error(stderr.trim() || `Claude Code exited with code ${code}`));
      else resolve(stdout);
    });

    // The question goes in through stdin rather than as an argument, which
    // avoids Windows' command-length limit and quoting problems.
    child.stdin.end(input);
  });
}
