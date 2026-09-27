/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cozy: {
          bg: 'rgb(var(--cozy-bg) / <alpha-value>)',
          surface: 'rgb(var(--cozy-surface) / <alpha-value>)',
          subtle: 'rgb(var(--cozy-subtle) / <alpha-value>)',
          border: 'rgb(var(--cozy-border) / <alpha-value>)',
          text: 'rgb(var(--cozy-text) / <alpha-value>)',
          muted: 'rgb(var(--cozy-muted) / <alpha-value>)',
          accent: 'rgb(var(--cozy-accent) / <alpha-value>)',
          amber: 'rgb(var(--cozy-amber) / <alpha-value>)',
          emerald: 'rgb(var(--cozy-emerald) / <alpha-value>)',
          sky: 'rgb(var(--cozy-sky) / <alpha-value>)',
          peach: '#0d9488',
          ocean: '#0d9488',
          mint: '#10b981',
          lavender: '#8b5cf6',
        },
        cozylight: {
          bg: '#f0f7fa',
          surface: '#ffffff',
          subtle: '#ecf5f9',
          border: '#dae6ee',
          text: '#162232',
          muted: '#596f85',
          accent: '#0d9488',
        }
      },
      borderRadius: {
        '2.5xl': '1.25rem',
        'squircle': '1.75rem', // 28px
        'squircle-lg': '2rem', // 32px
      },
      boxShadow: {
        'soft-sm': '0 2px 8px -1px rgba(0, 0, 0, 0.04), 0 1px 4px -1px rgba(0, 0, 0, 0.02)',
        'soft': '0 8px 24px -4px rgba(15, 23, 42, 0.04), 0 2px 8px -2px rgba(15, 23, 42, 0.02)',
        'soft-md': '0 12px 32px -6px rgba(15, 23, 42, 0.06), 0 4px 12px -2px rgba(15, 23, 42, 0.03)',
        'soft-lg': '0 20px 48px -10px rgba(15, 23, 42, 0.08), 0 8px 20px -4px rgba(15, 23, 42, 0.04)',
        'soft-xl': '0 25px 60px -12px rgba(15, 23, 42, 0.12)',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.06)',
        'glass-hover': '0 14px 40px 0 rgba(31, 38, 135, 0.1)',
        'glow-ocean': '0 0 25px -4px rgba(13, 148, 136, 0.28)',
        'glow-peach': '0 0 25px -4px rgba(13, 148, 136, 0.28)',
        'glow-mint': '0 0 25px -4px rgba(16, 185, 129, 0.22)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['"Outfit"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
