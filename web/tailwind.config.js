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
        oled: {
          base: 'rgb(var(--color-oled-base) / <alpha-value>)',
          card: 'rgb(var(--color-oled-card) / <alpha-value>)',
          hover: 'rgb(var(--color-oled-hover) / <alpha-value>)',
          active: 'rgb(var(--color-oled-active) / <alpha-value>)',
        },
        brand: {
          primary: 'rgb(var(--color-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-secondary) / <alpha-value>)',
          accent: 'rgb(var(--color-accent) / <alpha-value>)',
          accentHover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
          border: 'rgb(var(--color-border) / <alpha-value>)',
          foreground: 'rgb(var(--color-foreground) / <alpha-value>)',
          muted: 'rgb(var(--color-muted) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['var(--font-ui)', 'sans-serif'],
        display: ['var(--font-display)', 'sans-serif'],
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
      boxShadow: {
        'glow-accent': '0 0 20px -5px rgba(var(--color-accent) / 0.5)',
        'glow-secondary': '0 0 25px -5px rgba(var(--color-secondary) / 0.4)',
        'glow-indigo': '0 0 25px -5px rgba(var(--color-secondary) / 0.4)',
        'card-elevated': '0 12px 36px -12px rgba(59, 87, 101, 0.28)',
        'soft-button': '0 8px 20px -12px rgba(94, 69, 126, 0.5)',
      },
      keyframes: {
        pulseSlow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        equalizer: {
          '0%': { height: '30%' },
          '50%': { height: '100%' },
          '100%': { height: '40%' },
        }
      },
      animation: {
        'pulse-slow': 'pulseSlow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'equalizer-1': 'equalizer 0.8s ease-in-out infinite alternate',
        'equalizer-2': 'equalizer 1.1s ease-in-out infinite alternate 0.2s',
        'equalizer-3': 'equalizer 0.9s ease-in-out infinite alternate 0.4s',
      }
    },
  },
  plugins: [],
}
