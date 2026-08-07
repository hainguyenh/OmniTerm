interface PasswordHelpFieldProps {
  value: string
  onChange(value: string): void
  inputClass: string
  labelClass: string
}

export default function PasswordHelpField(props: PasswordHelpFieldProps) {
  return (
    <div className="space-y-0.5 rounded-xl border border-theme-border bg-theme-bg/50 px-3 py-2">
      <label htmlFor="connection-password-help-url" className={props.labelClass}>Password help link (optional)</label>
      <input
        id="connection-password-help-url"
        type="url"
        value={props.value}
        onChange={event => props.onChange(event.target.value)}
        placeholder="https://vault.company.example/connection"
        pattern="https://.*"
        className={props.inputClass}
      />
      <p className="text-[11px] text-theme-dim leading-snug">
        The connection provider opens this page before the OS client asks for your password. The password
        itself is never read or stored by OmniTerm.
      </p>
    </div>
  )
}
