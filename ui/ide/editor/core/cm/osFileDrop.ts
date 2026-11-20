/**
 * Files dropped from the OS onto a text editor open in their own tabs, as in IDEA and VS Code.
 * CodeMirror's own drop reads a dropped file into the document; in a window that receives OS drops
 * itself (see `installPageFileDrop`) the drop goes to the window-wide file drop first. Ahead of the
 * Markdown image drop too, which then gets the dropped paths through its registered drop handler.
 */
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { takePageFileDrop } from "@/workbench/fileDrop";

const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

export const osFileDrop = Prec.highest(
  EditorView.domEventHandlers({
    drop(event) {
      return carriesFiles(event) && takePageFileDrop(event);
    },
  }),
);
