/**
 * Anchored popover: portal + flip/shift positioning, Escape / outside-click /
 * window-deactivation dismissal (top-most popup only for Escape), optional
 * focus trap and focus restore.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  autoUpdate,
  flip,
  offset as offsetMw,
  shift,
  size as sizeMw,
  useFloating,
  type Placement,
  type VirtualElement,
} from "@floating-ui/react-dom";
import { clampDialogOffset } from "./dialogBounds";
import { FOCUSABLE, onWindowDeactivate, openLayer, trapTab } from "./popupState";
import styles from "./Popup.module.css";

export type PopupAnchor = Element | VirtualElement | RefObject<Element | null> | { x: number; y: number } | null;

export interface PopupProps {
  open: boolean;
  onClose: (reason: "escape" | "outside" | "action") => void;
  anchor: PopupAnchor;
  placement?: Placement;
  offset?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  role?: string;
  "aria-label"?: string;
  /** Keep Tab inside the popup. */
  trapFocus?: boolean;
  /** Focus on open: `true` = first `[data-autofocus]`/focusable/the popup itself; `false` = leave focus. */
  autoFocus?: boolean;
  restoreFocus?: boolean;
  closeOnOutsideClick?: boolean;
  /** Close (as "outside") when the app window loses focus, like IDEA popups (default true). */
  closeOnDeactivate?: boolean;
  /** Match the anchor's width (dropdowns). */
  matchWidth?: boolean;
  /** Plain surface without border/shadow styling. */
  unstyled?: boolean;
  /**
   * The popup can be moved by any `[data-popup-drag]` element inside it (its header), so it never
   * stays over what the user wants to see. It stays inside the window.
   */
  draggable?: boolean;
}

function toReference(anchor: PopupAnchor): Element | VirtualElement | null {
  if (!anchor) return null;
  if ("current" in anchor) return anchor.current;
  if ("getBoundingClientRect" in anchor) return anchor;
  const { x, y } = anchor;
  return {
    getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 }),
  };
}

export function Popup(props: PopupProps) {
  if (!props.open) return null;
  return <PopupInner {...props} />;
}

function PopupInner({
  onClose,
  anchor,
  placement = "bottom-start",
  offset = 4,
  children,
  className,
  style,
  role = "dialog",
  trapFocus = false,
  autoFocus = true,
  restoreFocus = true,
  closeOnOutsideClick = true,
  closeOnDeactivate = true,
  matchWidth = false,
  unstyled = false,
  draggable = false,
  ...aria
}: PopupProps) {
  const [moved, setMoved] = useState({ x: 0, y: 0 });
  const reference = toReference(anchor);
  const middleware = useMemo(
    () => [
      offsetMw(offset),
      flip({ padding: 6 }),
      shift({ padding: 6 }),
      sizeMw({
        padding: 6,
        apply({ rects, elements, availableHeight, availableWidth }) {
          elements.floating.style.maxHeight = `${Math.max(120, availableHeight)}px`;
          const width = Math.max(0, availableWidth);
          elements.floating.style.maxWidth = `${width}px`;
          if (matchWidth) elements.floating.style.minWidth = `${Math.min(rects.reference.width, width)}px`;
        },
      }),
    ],
    [offset, matchWidth],
  );
  const { refs, floatingStyles, isPositioned } = useFloating({
    placement,
    strategy: "fixed",
    transform: false,
    middleware,
    elements: { reference },
    whileElementsMounted: autoUpdate,
  });
  const elRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  // Read while rendering: content such as a menu focuses itself before any effect here runs.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const layer = openLayer(() => elRef.current);

    const onKey = (e: KeyboardEvent) => {
      if (!layer.isTop()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCloseRef.current("escape");
      } else if (e.key === "Tab" && trapFocus && elRef.current) {
        trapTab(e, elRef.current);
      }
    };
    const onPointer = (e: globalThis.PointerEvent) => {
      if (!closeOnOutsideClick) return;
      const target = e.target as Node;
      if (layer.containsFromHere(target)) return;
      const ref = toReference(anchor);
      if (ref instanceof Element && ref.contains(target)) return;
      onCloseRef.current("outside");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    const stopDeactivate = closeOnDeactivate ? onWindowDeactivate(() => onCloseRef.current("outside")) : undefined;
    return () => {
      stopDeactivate?.();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
      layer.release();
      const el = elRef.current;
      const active = document.activeElement;
      if (
        restoreFocus &&
        previous?.isConnected &&
        (!active || active === document.body || el?.contains(active) || !active.isConnected)
      ) {
        previous.focus({ preventScroll: true });
      }
    };
    // Anchor identity changes must not re-run open/close bookkeeping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoFocus) return;
    const el = elRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el;
    target.focus({ preventScroll: true });
  }, [autoFocus]);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    const el = elRef.current;
    if (!draggable || !el || e.button !== 0 || !(e.target as Element).closest("[data-popup-drag]")) return;
    if ((e.target as Element).closest("button, input, a, select, textarea")) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const start = { x: e.clientX - moved.x, y: e.clientY - moved.y };
    const base = { left: rect.left - moved.x, top: rect.top - moved.y };
    const move = (ev: globalThis.PointerEvent) => {
      if (!(ev.buttons & 1)) return up();
      setMoved(
        clampDialogOffset(
          { x: ev.clientX - start.x, y: ev.clientY - start.y },
          { ...base, width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return createPortal(
    <div
      onPointerDown={draggable ? startDrag : undefined}
      ref={(node) => {
        elRef.current = node;
        refs.setFloating(node);
      }}
      data-popup=""
      data-ide-surface=""
      role={role}
      aria-label={aria["aria-label"]}
      tabIndex={-1}
      className={clsx(styles.popup, !unstyled && styles.surface, className)}
      data-positioned={isPositioned || undefined}
      style={{
        ...floatingStyles,
        ...style,
        translate: moved.x || moved.y ? `${moved.x}px ${moved.y}px` : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
