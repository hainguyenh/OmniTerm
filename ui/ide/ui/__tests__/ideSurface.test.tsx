/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog } from "../Dialog";
import { Popup } from "../Popup";

// Both portal to <body>, outside [data-workbench]; `ui/index.css` exempts what carries this mark from
// the legacy input colours that stripped the frame off their text fields.
describe("IDE portals", () => {
  it("mark a dialog's fields as IDE-styled", () => {
    render(
      <Dialog open onClose={() => undefined} title="Find" platform="other">
        <input aria-label="field" />
      </Dialog>,
    );
    expect(screen.getByLabelText("field").closest("[data-ide-surface]")).not.toBeNull();
  });

  it("mark a popup's fields as IDE-styled", () => {
    const anchor = { current: document.createElement("button") };
    render(
      <Popup open onClose={() => undefined} anchor={anchor}>
        <input aria-label="field" />
      </Popup>,
    );
    expect(screen.getByLabelText("field").closest("[data-ide-surface]")).not.toBeNull();
  });
});
