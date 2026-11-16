/** Letter tiles of the built-in features; others use their initial. */
const PLUGIN_LETTERS: Readonly<Record<string, string>> = {
  'omniterm.agent-quota': 'Q',
  'omniterm.always-awake': 'A',
}

const PILL = 'rounded-lg px-1.5 text-[10.5px] leading-4 bg-[var(--bg-hover)] text-[var(--fg-secondary)]'
const PILL_OK = 'rounded-lg px-1.5 text-[10.5px] leading-4 bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-[var(--success)]'
const PILL_ERROR = 'rounded-lg px-1.5 text-[10.5px] leading-4 bg-[color-mix(in_srgb,var(--danger)_20%,transparent)] text-[var(--danger)]'

function StatusPill({ plugin }: { plugin: PluginDescriptor }) {
  if (plugin.status === 'loaded') return <span className={PILL_OK}>Running</span>
  if (plugin.status === 'error') return <span className={PILL_ERROR}>Error</span>
  if (plugin.status === 'incompatible') return <span className={PILL_ERROR}>Incompatible</span>
  return <span className={PILL}>Disabled</span>
}

interface PluginCardProps {
  plugin: PluginDescriptor
  busy: boolean
  /** Opens the plugin's settings page; absent when it has none (or it is not available now). */
  onConfigure?: () => void
  onToggle(): void
}

/**
 * One built-in feature, after the prototype's `.plug` row: letter tile, name, version, source and
 * state pills, description, package id, a Configure link and the enable switch. Disabled plugins dim.
 */
export function PluginCard({ plugin, busy, onConfigure, onToggle }: PluginCardProps) {
  const letter = PLUGIN_LETTERS[plugin.id] ?? (plugin.name.trim()[0] ?? '?').toUpperCase()
  return (
    <div
      data-testid="plugin-card"
      className={`mb-2 flex items-center gap-3 rounded-lg border border-[var(--border-strong)] px-2.5 py-2 ${plugin.enabled ? '' : 'opacity-60'}`}
    >
      <div aria-hidden className="grid h-[34px] w-[34px] flex-none place-items-center rounded-lg bg-[var(--bg-hover)] font-bold text-[var(--fg)]">
        {letter}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className="truncate text-[var(--fg-strong)]">{plugin.name}</b>
          <span className="text-[var(--fg-subtle)]">{plugin.version}</span>
          <span className={PILL}>{plugin.source === 'bundled' ? 'Bundled' : 'User'}</span>
          <StatusPill plugin={plugin} />
        </div>
        {plugin.description && <div className="text-xs text-[var(--fg-muted)]">{plugin.description}</div>}
        {plugin.error && <div className="text-xs text-[var(--danger)]">{plugin.error}</div>}
        <div className="truncate font-mono text-[11px] text-[var(--fg-subtle)]" title={plugin.permissions.join(', ')}>
          {plugin.id}
          {plugin.permissions.length > 0 && ` · ${plugin.permissions.join(', ')}`}
        </div>
      </div>
      {onConfigure && (
        <button type="button" onClick={onConfigure} className="flex-none text-[var(--link)] hover:underline">
          Configure
        </button>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={plugin.enabled}
        aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
        title="Enable or disable the plugin"
        disabled={busy || plugin.status === 'incompatible'}
        onClick={onToggle}
        className={`relative h-[18px] w-[34px] flex-none rounded-full transition-colors disabled:opacity-50 ${plugin.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'}`}
      >
        {/* Anchored with `left`, not `translate-x`: a <button> centers its content, so a translated
            knob would start mid-pill. */}
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${plugin.enabled ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}
