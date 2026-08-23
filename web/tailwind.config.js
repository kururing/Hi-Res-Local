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
          base: '#0F0F23',
          card: '#1B1B30',
          hover: '#242442',
          active: '#2E2D56',
        },
        brand: {
          primary: '#1E1B4B',
          secondary: '#4338CA',
          accent: '#22C55E',
          accentHover: '#16A34A',
          border: '#312E81',
          foreground: '#F8FAFC',
          muted: '#94A3B8',
        }
      },
      fontFamily: {
        sans: ['Poppins', 'Segoe UI', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'Roboto', 'sans-serif'],
        display: ['Righteous', 'Poppins', 'Trebuchet MS', 'Arial Black', 'sans-serif'],
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
      boxShadow: {
        'glow-accent': '0 0 20px -5px rgba(34, 197, 94, 0.5)',
        'glow-indigo': '0 0 25px -5px rgba(67, 56, 202, 0.4)',
        'card-elevated': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
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
