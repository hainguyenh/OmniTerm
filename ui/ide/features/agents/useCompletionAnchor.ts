import { useLayoutEffect, useState, type RefObject } from "react";
import type { VirtualElement } from "@floating-ui/react-dom";
import styles from "./Composer.module.css";

const TEXT_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textIndent",
  "textAlign",
  "textTransform",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

/** A textarea has no text DOM to measure; reproduce its wrapping and scroll offset. */
function caretRect(textarea: HTMLTextAreaElement, caret: number): DOMRect {
  const computed = getComputedStyle(textarea);
  const caretAnchor = document.createElement("div");
  caretAnchor.className = styles.caretAnchor ?? "";
  for (const property of TEXT_STYLES) caretAnchor.style[property] = computed[property];
  caretAnchor.style.width = `${textarea.clientWidth}px`;
  caretAnchor.textContent = textarea.value.slice(0, caret);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(caret) || "\u200b";
  caretAnchor.append(marker);
  document.body.append(caretAnchor);
  try {
    const box = textarea.getBoundingClientRect();
    const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.5;
    return new DOMRect(
      box.left + textarea.clientLeft + marker.offsetLeft - textarea.scrollLeft,
      box.top + textarea.clientTop + marker.offsetTop - textarea.scrollTop,
      0,
      lineHeight,
    );
  } finally {
    caretAnchor.remove();
  }
}

export function useCompletionAnchor(
  ref: RefObject<HTMLTextAreaElement | null>,
  caret: number | null,
  text: string,
): VirtualElement | null {
  const [anchor, setAnchor] = useState<VirtualElement | null>(null);
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea || caret === null) {
      setAnchor(null);
      return;
    }
    const update = () =>
      setAnchor({ contextElement: textarea, getBoundingClientRect: () => caretRect(textarea, caret) });
    update();
    textarea.addEventListener("scroll", update);
    return () => textarea.removeEventListener("scroll", update);
  }, [ref, caret, text]);
  return anchor;
}
