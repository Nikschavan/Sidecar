/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Claude Code warm color palette
        claude: {
          bg: '#1a1816',
          'bg-light': '#262220',
          'bg-lighter': '#302c29',
          surface: '#2a2624',
          border: '#3d3835',
          text: '#e8e4df',
          'text-muted': '#9a9590',
          'text-dim': '#6b6560',
          accent: '#c96442',
          'accent-hover': '#d97a5a',
          'tool-name': '#e07a5f',
          'user-bubble': '#3d3630',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      }
    },
  },
  plugins: [],
}
