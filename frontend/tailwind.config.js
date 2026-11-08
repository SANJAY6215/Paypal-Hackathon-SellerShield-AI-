/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { bg: '#080d19', panel: '#0e1626', panel2: '#121c31', line: '#1d2943', muted: '#8a97b5', ink: '#e6ebf7', ok: '#34d399', bad: '#f87171', warn: '#fbbf24', info: '#60a5fa' },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
};
