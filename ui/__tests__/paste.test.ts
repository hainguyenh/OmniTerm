import { describe, it, expect } from "vitest";
import {
  SCRIPT_OUTPUT_BANNER,
  canPasteAsPowerShellScript,
  clipboardActionFor,
  countScriptLines,
  formatPowerShellScriptForPaste,
  normalizePastePayload,
} from "../utils/paste";

const key = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("clipboardActionFor", () => {
  it("claims Ctrl+V on Windows/Linux", () => {
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true }), false)).toBe("paste");
  });

  // On macOS xterm produces no key for Cmd+V, so it never cancels the event and its own native
  // paste listener is already the only writer. Claiming it here would just add a way to double-fire.
  it("leaves Cmd+V to xterm's native paste on macOS", () => {
    expect(clipboardActionFor(key("KeyV", { metaKey: true }), true)).toBeNull();
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true }), true)).toBeNull();
  });

  it("claims Ctrl+Shift+V on every platform", () => {
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true, shiftKey: true }), false)).toBe("paste");
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true, shiftKey: true }), true)).toBe("paste");
  });

  it("claims Ctrl+Shift+C for copy but never plain Ctrl+C", () => {
    expect(clipboardActionFor(key("KeyC", { ctrlKey: true, shiftKey: true }), false)).toBe("copy");
    // Plain Ctrl+C must stay SIGINT.
    expect(clipboardActionFor(key("KeyC", { ctrlKey: true }), false)).toBeNull();
  });

  it("ignores combos that include Alt — except Alt+V, the image-paste binding", () => {
    expect(clipboardActionFor(key("KeyV", { altKey: true }), false)).toBe("paste");
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(clipboardActionFor(key("KeyC", { ctrlKey: true, shiftKey: true, altKey: true }), false)).toBeNull();
  });

  it("lets Alt+V fall through for agents that bind it to their own clipboard reader", () => {
    // Antigravity-style agents: the raw keystroke must reach xterm (which encodes ESC+v to the
    // PTY), so the app claims nothing.
    expect(clipboardActionFor(key("KeyV", { altKey: true }), false, true)).toBeNull();
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true, altKey: true }), false, true)).toBeNull();
    // Text clipboard routing is unaffected by the passthrough.
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true }), false, true)).toBe("paste");
    expect(clipboardActionFor(key("KeyC", { ctrlKey: true, shiftKey: true }), false, true)).toBe("copy");
  });

  it("ignores unrelated keys and unmodified V", () => {
    expect(clipboardActionFor(key("KeyV"), false)).toBeNull();
    expect(clipboardActionFor(key("KeyB", { ctrlKey: true }), false)).toBeNull();
  });
});

describe("normalizePastePayload", () => {
  // Sending CRLF verbatim is what made a multi-line paste execute its lines as commands.
  it("collapses CRLF and lone LF to CR", () => {
    expect(normalizePastePayload("a\r\nb\nc", false)).toBe("a\rb\rc");
  });

  it("wraps in bracketed-paste markers when the mode is on", () => {
    expect(normalizePastePayload("hi", true)).toBe("\x1b[200~hi\x1b[201~");
  });

  it("omits the markers when the mode is off", () => {
    expect(normalizePastePayload("hi", false)).toBe("hi");
  });

  it("normalizes before bracketing, so the markers bracket the whole payload", () => {
    expect(normalizePastePayload("a\r\nb", true)).toBe("\x1b[200~a\rb\x1b[201~");
  });

  it("recognizes explicit script paste when isScriptPaste is true", () => {
    expect(clipboardActionFor(key("KeyV", { ctrlKey: true, altKey: true }), false, false, true)).toBe("paste-script");
  });

  it("passes text with no line breaks through untouched", () => {
    expect(normalizePastePayload("plain text", false)).toBe("plain text");
  });
});

describe("formatPowerShellScriptForPaste", () => {
  const banner = `Write-Host "\`n${SCRIPT_OUTPUT_BANNER}" -ForegroundColor Cyan`;

  it("returns empty string for empty or whitespace-only inputs", () => {
    expect(formatPowerShellScriptForPaste("")).toBe("");
    expect(formatPowerShellScriptForPaste("   \n  \t  ")).toBe("");
  });

  it("wraps a multiline script in a dot-sourced block tagged as OmniTerm's, with an output banner", () => {
    const script = 'Get-Process | Where-Object { $_.CPU -gt 10 }\nWrite-Host "Done"';
    expect(formatPowerShellScriptForPaste(script)).toBe(
      `. { # >>> OmniTerm: pasted script, 2 lines - Enter runs, Ctrl+C discards\n${banner} # OmniTerm\n${script}\n} # <<< end of pasted script`,
    );
  });

  it("keeps the user's lines verbatim between the generated header, divider and footer lines", () => {
    const script = 'param($Name = "x")\n  Write-Host $Name\n# trailing comment';
    const lines = formatPowerShellScriptForPaste(script).split("\n");
    expect(lines.slice(2, -1).join("\n")).toBe(script);
    expect(lines[0]).toContain("# >>> OmniTerm");
    expect(lines[1]).toBe(`${banner} # OmniTerm`);
    expect(lines.at(-1)).toBe("} # <<< end of pasted script");
  });

  it("keeps every generated line short enough not to wrap (regression: overlapping PSReadLine redraw)", () => {
    const lines = formatPowerShellScriptForPaste("Get-Date\nGet-Location").split("\n");
    for (const line of [lines[0], lines[1], lines.at(-1) ?? ""]) expect(line.length).toBeLessThan(80);
  });

  it("never ends with a newline, so nothing runs until the user presses Enter", () => {
    expect(formatPowerShellScriptForPaste("Write-Host one\nWrite-Host two")).not.toMatch(/[\r\n]$/);
  });

  it("counts a single line in the singular", () => {
    expect(formatPowerShellScriptForPaste("Get-Date")).toContain("pasted script, 1 line -");
  });

  it("keeps existing dot-sourced or call-wrapped blocks without double wrapping", () => {
    const dotSourced = '. {\n  Write-Host "Hi"\n}';
    expect(formatPowerShellScriptForPaste(dotSourced)).toBe(`${banner}; ${dotSourced}`);

    const callWrapped = '& {\n  Write-Host "Child"\n}';
    expect(formatPowerShellScriptForPaste(callWrapped)).toBe(`${banner}; ${callWrapped}`);
  });

  it("dot-sources a bare curly-brace block instead of nesting it", () => {
    const formatted = formatPowerShellScriptForPaste('{\n  Write-Host "Bare"\n}');
    expect(formatted).toContain('\n  Write-Host "Bare"\n}');
    expect(formatted.match(/\{/g)).toHaveLength(1);
  });
});

describe("countScriptLines", () => {
  it("counts lines across CRLF, CR and LF endings", () => {
    expect(countScriptLines("a\r\nb\rc\nd")).toBe(4);
    expect(countScriptLines("  \n ")).toBe(0);
  });
});

describe("canPasteAsPowerShellScript", () => {
  const pwsh = { platform: "win32", connectionType: "LOCAL", shell: "powershell" };

  it("accepts a local Windows PowerShell pane, including the default shell", () => {
    expect(canPasteAsPowerShellScript(pwsh)).toBe(true);
    expect(canPasteAsPowerShellScript({ ...pwsh, shell: "default" })).toBe(true);
    expect(canPasteAsPowerShellScript({ ...pwsh, shell: undefined })).toBe(true);
  });

  it("falls back for cmd, WSL, SSH, non-Windows hosts and agent TUIs", () => {
    expect(canPasteAsPowerShellScript({ ...pwsh, shell: "cmd" })).toBe(false);
    expect(canPasteAsPowerShellScript({ ...pwsh, shell: "wsl" })).toBe(false);
    expect(canPasteAsPowerShellScript({ ...pwsh, connectionType: "SSH" })).toBe(false);
    expect(canPasteAsPowerShellScript({ ...pwsh, platform: "linux", shell: "default" })).toBe(false);
    expect(canPasteAsPowerShellScript({ ...pwsh, agentName: "Claude Code" })).toBe(false);
  });
});
