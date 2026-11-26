/**
 * Where a tab that is not a file runs (a terminal, an agent session), for the navigation bar:
 * `project › dirs › <tab>` like a file's path, or `<host> › <tab>` for a remote one. Keyed by
 * the tab's editor input key; the feature owning those tabs publishes and keeps them current.
 */
import { create } from "zustand";

export interface TabPlace {
  /** The working folder, absolute (`/` separated); null when it is not on this machine. */
  dir: string | null;
  /** Shown instead of the folder crumbs when `dir` is null (`user@host:22`). */
  host?: string | null;
  /** The tab's own crumb: the shell or the agent running in it. */
  label: string;
  icon: string;
  title?: string;
}

export const useTabPlaces = create<{ places: Readonly<Record<string, TabPlace>> }>(() => ({ places: {} }));

/** Replaces the places of the keys starting with `prefix` (one owner's tabs) with `places`. */
export function publishTabPlaces(prefix: string, places: Record<string, TabPlace>): void {
  useTabPlaces.setState((s) => {
    const kept = Object.fromEntries(Object.entries(s.places).filter(([key]) => !key.startsWith(prefix)));
    return { places: { ...kept, ...places } };
  });
}
