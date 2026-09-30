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
        '2.5xl': '1rem',
        'squircle': '0.75rem',
        'squircle-lg': '1rem',
      },
      boxShadow: {
        'soft-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'soft': '0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.05)',
        'soft-md': '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
        'soft-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04)',
        'soft-xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
        'glass': 'none',
        'glass-hover': 'none',
        'glow-ocean': 'none',
        'glow-peach': 'none',
        'glow-mint': 'none',
      },
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1rem' }],        // 12px
        'xs': ['0.8125rem', { lineHeight: '1.2rem' }],     // 13px (was 12px)
        'sm': ['0.9375rem', { lineHeight: '1.4rem' }],     // 15px (was 14px)
        'base': ['1.0625rem', { lineHeight: '1.625rem' }], // 17px (was 16px)
        'lg': ['1.1875rem', { lineHeight: '1.75rem' }],    // 19px (was 18px)
        'xl': ['1.3125rem', { lineHeight: '1.875rem' }],   // 21px (was 20px)
        '2xl': ['1.625rem', { lineHeight: '2.125rem' }],   // 26px (was 24px)
        '3xl': ['2rem', { lineHeight: '2.375rem' }],       // 32px (was 30px)
        '4xl': ['2.375rem', { lineHeight: '2.75rem' }],    // 38px (was 36px)
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['"Outfit"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
