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
        },
        cozylight: {
          bg: '#f8fafc',
          surface: '#ffffff',
          subtle: '#f1f5f9',
          border: '#e2e8f0',
          text: '#0f172a',
          muted: '#64748b',
          accent: '#0284c7',
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
