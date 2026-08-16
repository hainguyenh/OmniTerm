import React, { forwardRef } from 'react'
import { Tooltip, type TooltipPlacement } from './Tooltip'

export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional custom tooltip text or node displayed on hover/focus. */
  tooltip?: React.ReactNode
  /** Optional keyboard shortcut combo displayed in the tooltip with retro keycap style. */
  shortcut?: string
  /** Placement direction for the tooltip. Defaults to 'bottom'. */
  tooltipPlacement?: TooltipPlacement
  /** Tooltip hover delay in milliseconds. Defaults to 150ms. */
  tooltipDelay?: number
  /** Visual variant of the button. Defaults to 'default'. */
  variant?: ButtonVariant
  /** Button sizing variant. Defaults to 'md'. */
  size?: ButtonSize
  /** Left icon element. */
  icon?: React.ReactNode
  /** Right icon element. */
  iconRight?: React.ReactNode
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  default:
    'border border-theme-border bg-theme-popup text-theme-fg hover:bg-white/10 hover:border-theme-accent active:scale-[0.98]',
  primary:
    'border border-transparent bg-theme-accent text-theme-accent-fg hover:brightness-110 active:scale-[0.98]',
  secondary:
    'border border-transparent bg-white/5 text-theme-fg hover:bg-white/10 active:scale-[0.98]',
  ghost:
    'border border-transparent text-theme-dim hover:text-theme-fg hover:bg-white/5 active:scale-[0.98]',
  outline:
    'border border-theme-border text-theme-fg hover:border-theme-accent hover:text-theme-accent active:scale-[0.98]',
  danger:
    'border border-transparent bg-theme-error text-white hover:brightness-110 active:scale-[0.98]',
}

const SIZE_STYLES: Record<ButtonSize, string> = {
  xs: 'h-5 px-1.5 text-[10px] rounded gap-1',
  sm: 'h-6 px-2 text-[11px] rounded-md gap-1.5',
  md: 'h-7 px-2.5 text-xs rounded-lg gap-2',
  lg: 'h-8 px-3 text-sm rounded-lg gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      tooltip,
      shortcut,
      tooltipPlacement = 'bottom',
      tooltipDelay = 150,
      variant = 'default',
      size = 'md',
      icon,
      iconRight,
      className = '',
      children,
      type = 'button',
      disabled,
      ...rest
    },
    ref,
  ) => {
    const baseBtn = (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={`inline-flex items-center justify-center font-medium select-none transition-all duration-150 outline-none focus-visible:ring-1 focus-visible:ring-theme-accent disabled:pointer-events-none disabled:opacity-40 ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${className}`}
        {...rest}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {children}
        {iconRight && <span className="flex-shrink-0">{iconRight}</span>}
      </button>
    )

    // No tooltip while disabled: disabled controls fire no mouse events, so the popup could
    // never show and the wrapper would only add dead weight.
    if (tooltip && !disabled) {
      return (
        <Tooltip content={tooltip} shortcut={shortcut} placement={tooltipPlacement} delay={tooltipDelay}>
          {baseBtn}
        </Tooltip>
      )
    }

    return baseBtn
  },
)

Button.displayName = 'Button'
