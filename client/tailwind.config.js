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
          bg: '#0f1117',
          surface: '#181b24',
          subtle: '#222734',
          border: '#2e3446',
          text: '#f1f5f9',
          muted: '#94a3b8',
          accent: '#38bdf8',
          amber: '#fbbf24',
          emerald: '#34d399',
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
