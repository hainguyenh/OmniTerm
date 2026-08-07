/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./ui/**/*.{js,ts,jsx,tsx}",
    // Plugin-provided renderer components are bundled into the same page, so their classes have to be
    // scanned too — otherwise Tailwind emits no CSS for them and they render unstyled.
    "./plugins/*/app/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        theme: {
          bg: 'var(--theme-bg)',
          sidebar: 'var(--theme-sidebar-bg)',
          popup: 'var(--theme-popup-bg)',
          border: 'var(--theme-border)',
          fg: 'var(--theme-fg)',
          dim: 'var(--theme-dim)',
          accent: 'var(--theme-accent)',
          'accent-fg': 'var(--theme-accent-fg, #1a1b26)',
          hover: 'var(--theme-hover-bg)',
          selection: 'var(--theme-selection)',
          'selection-fg': 'var(--theme-selection-fg)',
          card: 'var(--theme-card-bg)',
          warning: 'var(--theme-warning)',
          error: 'var(--theme-error)',
          success: 'var(--theme-success)',
        }
      },
      borderRadius: {
        'sm': 'var(--theme-rounded-sm)',
        'md': 'var(--theme-rounded-md)',
        'lg': 'var(--theme-rounded-lg)',
        'xl': 'var(--theme-rounded-xl)',
      }
    },
  },
  plugins: [],
}
