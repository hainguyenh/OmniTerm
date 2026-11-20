import type { ComponentType } from "react";
import { create } from "zustand";
import { ErrorBoundary } from "../ErrorBoundary";

export type StripeItemSide = "left" | "right";

/**
 * Something other than a tool window button on a stripe, right under the stripe's top group
 * (OmniTerm's Agent quota status line). The component decides itself whether it shows.
 */
export interface StripeItemContribution {
  id: string;
  /** Lower first. */
  order?: number;
  component: ComponentType<{ side: StripeItemSide }>;
}

const useStripeItems = create<{ items: readonly StripeItemContribution[] }>(() => ({ items: [] }));

export function registerStripeItem(item: StripeItemContribution): () => void {
  useStripeItems.setState((s) => ({
    items: [...s.items.filter((i) => i.id !== item.id), item].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  }));
  return () => useStripeItems.setState((s) => ({ items: s.items.filter((i) => i !== item) }));
}

export function StripeItems({ side }: { side: StripeItemSide }) {
  const items = useStripeItems((s) => s.items);
  return (
    <>
      {items.map(({ id, component: C }) => (
        <ErrorBoundary key={id} name={`stripe item ${id}`}>
          <C side={side} />
        </ErrorBoundary>
      ))}
    </>
  );
}
