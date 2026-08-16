/**
 * Shared harness for the terminalStream test suites: a fake xterm, a channel that hands back
 * its callbacks so a test can drive them directly, and an `attach` wrapper with spies.
 */
import { vi } from "vitest";
import { attachTerminalStream } from "../utils/terminalStream";
import type { SessionChannel } from "../utils/sessionChannel";
import type { Terminal } from "@xterm/xterm";

export type ResumeSnapshot = Awaited<ReturnType<Window["omnitermAPI"]["terminalWindow"]["resume"]>>;

export const bytes = (text: string) => new TextEncoder().encode(text);

export function makeTerminal() {
  return { write: vi.fn(), options: {} as Record<string, unknown> };
}

/** A channel that hands back the callbacks it was given, so a test can drive them directly. */
export function makeChannel() {
  const fire: {
    ready?: (label?: string) => void;
    data?: (data: Uint8Array) => void;
    error?: (err: string) => void;
    closed?: (code?: number) => void;
  } = {};
  const unsubscribe = {
    ready: vi.fn(),
    data: vi.fn(),
    error: vi.fn(),
    closed: vi.fn(),
  };
  const channel: SessionChannel = {
    connect: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
    onReady: (cb) => ((fire.ready = cb), unsubscribe.ready),
    onData: (cb) => ((fire.data = cb), unsubscribe.data),
    onError: (cb) => ((fire.error = cb), unsubscribe.error),
    onClosed: (cb) => ((fire.closed = cb), unsubscribe.closed),
  };
  return { channel, fire, unsubscribe };
}

export function attach(overrides: Partial<Parameters<typeof attachTerminalStream>[0]> = {}) {
  const term = makeTerminal();
  const { channel, fire, unsubscribe } = makeChannel();
  const spies = {
    onStatus: vi.fn(),
    onExit: vi.fn(),
    onMetrics: vi.fn(),
    onActivity: vi.fn(),
    refit: vi.fn(),
  };
  const stream = attachTerminalStream({
    term: term as unknown as Terminal,
    api: channel,
    id: "pane-1",
    isLocal: false,
    host: "example.test",
    mode: "connect",
    smartColors: () => true,
    isCurrent: () => true,
    ...spies,
    ...overrides,
  });
  return { term, fire, unsubscribe, stream, ...spies };
}

/** Everything written to the terminal since attach, concatenated. */
export const written = (term: ReturnType<typeof makeTerminal>) =>
  term.write.mock.calls.map(([chunk]) => chunk as string).join("");
