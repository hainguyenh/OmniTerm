import { create } from 'zustand'

import type { TitleControlsProps } from '../components/TitleControls'

/**
 * The workbench title bar is mounted below the app root, so the app settings its controls edit are
 * handed over through this store instead of props. `App` publishes them; nothing else writes.
 */
export const useTitleControlsProps = create<{ props: TitleControlsProps | null }>(() => ({ props: null }))
