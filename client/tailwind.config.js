/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand:    '#00ffcc',
        'brand-dim': 'rgba(0, 255, 204, 0.1)',
        'bg-primary':   '#050508',
        'bg-secondary': '#0a0a10',
        'bg-card':      '#0d0d16',
        'bg-card2':     '#14141e',
        'border-dim':   '#1a1a2e',
        'border-mid':   '#2a2a40',
        'border-hi':    '#4a4a6a',
        'text-pri':     '#e2e2ff',
        'text-sec':     '#9a9aca',
        'text-muted':   '#5a5a7a',
      },
      fontFamily: {
        pixel: ['Pixelify Sans', 'sans-serif'],
        vt: ['VT323', 'monospace'],
        mono: ['JetBrains Mono', 'monospace'],
        silk: ['Silkscreen', 'cursive'],
      },
      animation: {
        'bob': 'bob 2s ease-in-out infinite',
        'shake': 'shake 0.4s cubic-bezier(.36,.07,.19,.97) infinite',
        'blink': 'blink 1s step-end infinite',
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        bob: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        shake: {
          '10%, 90%': { transform: 'translate3d(-1px, 0, 0)' },
          '20%, 80%': { transform: 'translate3d(2px, 0, 0)' },
          '30%, 50%, 70%': { transform: 'translate3d(-2px, 0, 0)' },
          '40%, 60%': { transform: 'translate3d(2px, 0, 0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        }
      }
    },
  },
  plugins: [],
};
