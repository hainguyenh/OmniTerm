/** @vitest-environment jsdom */
/**
 * The byte path every pane runs on.
 *
 * `attachTerminalStream` is only reached through TerminalView, whose coverage file sits at the hard
 * 500-line .tsx ceiling and cannot grow — so the behaviours that matter here (the cold-boot status
 * hold, replay-without-colouring, chunk-split UTF-8) had no direct test at all. Each of those is a
 * fix for a shipped bug, and each is invisible from the component level.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WRITE_CHUNK_SIZE } from "../utils/writeChunks";
import { mockOmnitermAPI } from "../testUtils";
import { attach, bytes, written, type ResumeSnapshot } from "./terminalStreamHarness";

beforeEach(() => {
  mockOmnitermAPI();
});

describe("attachTerminalStream — connect", () => {
  it("holds a local pane at 'connecting' until the first byte arrives", () => {
    // A cold WSL VM answers the ConPTY handshake immediately and then goes silent for seconds.
    // Flipping to 'connected' on ready dropped the loading overlay onto a blank pane.
    const { fire, onStatus } = attach({ isLocal: true });

    fire.ready?.();
    expect(onStatus.mock.calls.flat()).not.toContain("connected");

    fire.data?.(bytes("$ "));
    expect(onStatus).toHaveBeenLastCalledWith("connected");
  });

  it("connects an SSH pane on ready and announces the host", () => {
    const { term, fire, onStatus, refit } = attach({ host: "box.example" });

    fire.ready?.();
    expect(onStatus).toHaveBeenLastCalledWith("connected");
    expect(written(term)).toBe("\r\n\x1b[32mConnected to box.example\x1b[0m\r\n");
    expect(refit).toHaveBeenCalledTimes(1);
  });

  it("refits a local pane on ready even though the status is unchanged", () => {
    const { fire, refit } = attach({ isLocal: true });
    fire.ready?.();
    expect(refit).toHaveBeenCalledTimes(1);
  });

  it("starts the session through the channel in connect mode", () => {
    const { onStatus } = attach();
    expect(onStatus).toHaveBeenCalledWith("connecting");
  });
});

describe("attachTerminalStream — output", () => {
  it("splits an oversized payload without altering a byte of it", () => {
    const { term, fire } = attach({ smartColors: () => false });
    const payload = "x".repeat(WRITE_CHUNK_SIZE * 2 + 7);

    fire.data?.(bytes(payload));

    expect(term.write.mock.calls.length).toBeGreaterThan(1);
    expect(written(term)).toBe(payload);
  });

  it("passes a payload at exactly the chunk size through as one write", () => {
    const { term, fire } = attach({ smartColors: () => false });
    fire.data?.(bytes("y".repeat(WRITE_CHUNK_SIZE)));
    expect(term.write).toHaveBeenCalledTimes(1);
  });

  it("reassembles a multi-byte character split across two messages", () => {
    // The streaming TextDecoder is the only thing standing between a chunk boundary and a pair of
    // replacement glyphs in the middle of the user's output.
    const { term, fire } = attach({ smartColors: () => false });
    const euro = bytes("€");

    fire.data?.(euro.slice(0, 1));
    fire.data?.(euro.slice(1));

    expect(written(term)).toBe("€");
    expect(written(term)).not.toContain("�");
  });

  it("reads smartColors at write time, not at attach time", () => {
    let colours = false;
    const { term, fire } = attach({ smartColors: () => colours });

    fire.data?.(bytes("error 404\n"));
    const plain = written(term);
    colours = true;
    term.write.mockClear();
    fire.data?.(bytes("error 404\n"));

    expect(plain).toBe("error 404\n");
    expect(written(term)).not.toBe(plain);
  });

  it("reports an error without ending the session", () => {
    const { term, fire, onStatus, onExit } = attach();
    fire.error?.("host unreachable");

    expect(onStatus).toHaveBeenLastCalledWith("error");
    expect(written(term)).toContain("Error: host unreachable");
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe("attachTerminalStream — exit", () => {
  it("retires input and reports the exit code", () => {
    const { term, fire, onStatus, onExit } = attach();
    fire.closed?.(3);

    expect(onStatus).toHaveBeenLastCalledWith("closed");
    // A blinking cursor on a dead pane reads as a live prompt; every key typed into it is dropped.
    expect(term.options.cursorBlink).toBe(false);
    expect(term.options.disableStdin).toBe(true);
    expect(written(term)).toContain("Connection closed (exit code 3)");
    expect(onExit).toHaveBeenCalledWith(3);
  });

  it("reports a codeless close as a clean exit with no code in the banner", () => {
    const { term, fire, onExit } = attach();
    fire.closed?.(undefined);

    expect(written(term)).toContain("Connection closed\x1b[0m");
    expect(written(term)).not.toContain("exit code");
    expect(onExit).toHaveBeenCalledWith(0);
  });
});

describe("attachTerminalStream — attach mode", () => {
  const resumeWith = (snapshot: ResumeSnapshot) =>
    mockOmnitermAPI({ terminalWindow: { resume: async () => snapshot } });

  it("writes the replay verbatim even while smart colouring is on", async () => {
    // Running the highlighter's alternation over a quarter-megabyte replay, synchronously, was most
    // of the freeze on attach. The highlighter still *sees* the text so its escape state stays in
    // sync — it just must not rewrite it.
    resumeWith({ data: new Uint8Array(0), status: "ready", generation: 1 });
    const { term, fire, stream } = attach({ mode: "attach", smartColors: () => true });

    fire.data?.(bytes("error 404\n"));
    expect(written(term)).toBe("error 404\n");

    stream.dispose();
  });

  it("colourizes the message after the replay", async () => {
    resumeWith({ data: new Uint8Array(0), status: "ready", generation: 1 });
    const { term, fire } = attach({ mode: "attach", smartColors: () => true });

    fire.data?.(bytes("first\n"));
    term.write.mockClear();
    fire.data?.(bytes("error 404\n"));

    expect(written(term)).not.toBe("error 404\n");
  });

  it("clears the replay flag when the session had nothing buffered", async () => {
    // No replay message ever arrives, so only resume() settling can clear the flag — otherwise the
    // first live message is written uncoloured forever.
    resumeWith({ data: new Uint8Array(0), status: "ready", generation: 1 });
    const { term, fire, onStatus } = attach({ mode: "attach", smartColors: () => true });

    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("connected"));
    fire.data?.(bytes("error 404\n"));

    expect(written(term)).not.toBe("error 404\n");
  });

  it("writes an inline snapshot buffer chunked and uncoloured", async () => {
    const payload = "error ".repeat(WRITE_CHUNK_SIZE / 3);
    resumeWith({ data: bytes(payload), status: "ready", generation: 1 });
    const { term, onStatus } = attach({ mode: "attach", smartColors: () => true });

    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("connected"));
    expect(written(term)).toBe(payload);
    expect(term.write.mock.calls.length).toBeGreaterThan(1);
  });

  it("restores a closed session's status without a second exit banner", async () => {
    resumeWith({ data: new Uint8Array(0), status: "closed", generation: 1 });
    const { term, onStatus, onExit } = attach({ mode: "attach" });

    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("closed"));
    expect(term.options.disableStdin).toBe(true);
    expect(written(term)).toContain("Connection closed");
    // The pane is being re-bound, not exiting now — nothing should re-run the exit handler.
    expect(onExit).not.toHaveBeenCalled();
  });

  it("surfaces a session that no longer exists", async () => {
    resumeWith(null);
    const { term, onStatus } = attach({ mode: "attach" });

    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("error"));
    expect(written(term)).toContain("session is no longer available");
  });

  it("drops a resume that settles after the pane was torn down", async () => {
    resumeWith({ data: bytes("late"), status: "ready", generation: 1 });
    const { term, onStatus } = attach({ mode: "attach", isCurrent: () => false });

    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith("connecting"));
    await Promise.resolve();

    expect(onStatus.mock.calls.flat()).not.toContain("connected");
    expect(written(term)).toBe("");
  });
});

describe("attachTerminalStream — side channels", () => {
  it("subscribes a local pane to activity and not to remote metrics", () => {
    const onSessionMetrics = vi.fn(() => vi.fn());
    const onLocalActivity = vi.fn(() => vi.fn());
    mockOmnitermAPI({ connect: { onSessionMetrics, onLocalActivity } });

    attach({ isLocal: true });

    expect(onLocalActivity).toHaveBeenCalledTimes(1);
    expect(onSessionMetrics).not.toHaveBeenCalled();
  });

  it("subscribes an SSH pane to remote metrics and not to activity", () => {
    const onSessionMetrics = vi.fn(() => vi.fn());
    const onLocalActivity = vi.fn(() => vi.fn());
    mockOmnitermAPI({ connect: { onSessionMetrics, onLocalActivity } });

    attach({ isLocal: false });

    expect(onSessionMetrics).toHaveBeenCalledTimes(1);
    expect(onLocalActivity).not.toHaveBeenCalled();
  });

  it("drops every subscription on dispose, including the unused side channel", () => {
    const releaseMetrics = vi.fn();
    mockOmnitermAPI({ connect: { onSessionMetrics: () => releaseMetrics } });
    const { stream, unsubscribe } = attach({ isLocal: false });

    expect(() => stream.dispose()).not.toThrow();

    for (const release of Object.values(unsubscribe)) {
      expect(release).toHaveBeenCalledTimes(1);
    }
    expect(releaseMetrics).toHaveBeenCalledTimes(1);
  });

  it("suspends colouring over a paste the shell is about to echo", () => {
    const { term, fire, stream } = attach({ smartColors: () => true });

    stream.noteLocalEcho();
    fire.data?.(bytes("error 404\n"));

    expect(written(term)).toBe("error 404\n");
  });
});
