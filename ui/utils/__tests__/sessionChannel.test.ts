/** @vitest-environment jsdom */
/**
 * The adapter that lets everything above TerminalView stop caring whether a pane is SSH or LOCAL.
 *
 * Three of its decisions are invisible from any integration test and each has a real failure mode:
 * the `id`/`connId` split (one saved connection running as several panes), the arity of the connect
 * call (an explicit `undefined` is not the same as an omitted argument to the Tauri command), and
 * SSH synthesizing an exit code it never receives.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionChannel } from "../sessionChannel";
import { mockOmnitermAPI } from "../../testUtils";

/** A subscription spy whose recorded arguments stay typed, so a test can replay the callback. */
const subscription = <Callback>() => vi.fn((_id: string, _cb: Callback) => vi.fn());

/** Every connect-surface member this adapter can reach, as spies. */
function spyConnect() {
  const connect = {
    local: vi.fn(),
    localInput: vi.fn(),
    localResize: vi.fn(),
    onLocalReady: subscription<(label?: string) => void>(),
    onLocalData: subscription<(data: Uint8Array) => void>(),
    onLocalError: subscription<(err: string) => void>(),
    onLocalClosed: subscription<(code?: number) => void>(),
    ssh: vi.fn(),
    sshInput: vi.fn(),
    sshResize: vi.fn(),
    onSSHReady: subscription<(label?: string) => void>(),
    onSSHData: subscription<(data: Uint8Array) => void>(),
    onSSHError: subscription<(err: string) => void>(),
    onSSHClosed: subscription<() => void>(),
  };
  mockOmnitermAPI({ connect });
  return connect;
}

beforeEach(() => {
  mockOmnitermAPI();
});

describe("createSessionChannel — LOCAL", () => {
  it("carries the pane key and the saved connection separately", () => {
    // They diverge when one saved LOCAL connection runs as several independent instances; passing
    // the pane key as the connection id would load the wrong shell settings.
    const connect = spyConnect();
    const channel = createSessionChannel(true, "pane-2", "conn-a", "pwsh", true);

    channel.connect();
    channel.input("ls\r");
    channel.resize({ cols: 80, rows: 24 });

    expect(connect.local).toHaveBeenCalledWith("pane-2", "conn-a", "pwsh", true);
    expect(connect.localInput).toHaveBeenCalledWith("pane-2", "ls\r");
    expect(connect.localResize).toHaveBeenCalledWith("pane-2", { cols: 80, rows: 24 });
  });

  it("omits darkMode rather than passing it as undefined", () => {
    const connect = spyConnect();
    createSessionChannel(true, "pane-1", "conn-a", "pwsh").connect();

    // An explicit trailing `undefined` reaches the Tauri command as a present-but-null argument.
    expect(connect.local.mock.calls[0]).toHaveLength(3);
  });

  it("subscribes each stream under the pane key", () => {
    const connect = spyConnect();
    const channel = createSessionChannel(true, "pane-1", "conn-a");
    const callbacks = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];

    channel.onReady(callbacks[0]);
    channel.onData(callbacks[1]);
    channel.onError(callbacks[2]);
    channel.onClosed(callbacks[3]);

    expect(connect.onLocalReady).toHaveBeenCalledWith("pane-1", callbacks[0]);
    expect(connect.onLocalData).toHaveBeenCalledWith("pane-1", callbacks[1]);
    expect(connect.onLocalError).toHaveBeenCalledWith("pane-1", callbacks[2]);
    expect(connect.onLocalClosed).toHaveBeenCalledWith("pane-1", callbacks[3]);
  });

  it("passes a real exit code through, including none at all", () => {
    const connect = spyConnect();
    const received: (number | undefined)[] = [];
    createSessionChannel(true, "pane-1", "conn-a").onClosed((code) => received.push(code));

    const forward = connect.onLocalClosed.mock.calls[0][1];
    forward(7);
    forward(undefined);

    expect(received).toEqual([7, undefined]);
  });

  it("returns the underlying unsubscribe untouched", () => {
    const release = vi.fn();
    mockOmnitermAPI({ connect: { onLocalData: () => release } });

    expect(createSessionChannel(true, "pane-1", "conn-a").onData(vi.fn())).toBe(release);
  });
});

describe("createSessionChannel — SSH", () => {
  it("addresses the session by pane key and ignores the saved connection", () => {
    const connect = spyConnect();
    const channel = createSessionChannel(false, "pane-3", "conn-b", undefined, false);

    channel.connect();
    channel.input("uptime\r");
    channel.resize({ cols: 120, rows: 40 });

    expect(connect.ssh).toHaveBeenCalledWith("pane-3", false);
    expect(connect.sshInput).toHaveBeenCalledWith("pane-3", "uptime\r");
    expect(connect.sshResize).toHaveBeenCalledWith("pane-3", { cols: 120, rows: 40 });
  });

  it("omits darkMode rather than passing it as undefined", () => {
    const connect = spyConnect();
    createSessionChannel(false, "pane-1", "conn-b").connect();

    expect(connect.ssh.mock.calls[0]).toHaveLength(1);
  });

  it("discards the ready label SSH reports", () => {
    // The SSH path has no shell name worth showing, so the banner comes from the host instead.
    const connect = spyConnect();
    const onReady = vi.fn();
    createSessionChannel(false, "pane-1", "conn-b").onReady(onReady);

    connect.onSSHReady.mock.calls[0][1]("bash");

    expect(onReady).toHaveBeenCalledWith();
    expect(onReady.mock.calls[0]).toHaveLength(0);
  });

  it("synthesizes a clean exit because SSH reports no status of its own", () => {
    const connect = spyConnect();
    const onClosed = vi.fn();
    createSessionChannel(false, "pane-1", "conn-b").onClosed(onClosed);

    connect.onSSHClosed.mock.calls[0][1]();

    expect(onClosed).toHaveBeenCalledWith(0);
  });
});
