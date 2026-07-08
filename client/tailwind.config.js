/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand:    '#00d4b8',
        'brand-dim': 'rgba(0,212,184,0.08)',
        'bg-primary':   '#0a0a0f',
        'bg-secondary': '#111118',
        'bg-card':      '#16161e',
        'bg-card2':     '#1c1c28',
        'border-dim':   '#1e1e2e',
        'border-mid':   '#2a2a3e',
        'text-pri':     '#e2e2f0',
        'text-sec':     '#8888a8',
        'text-muted':   '#4a4a6a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow':  'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'slide-down':  'slideDown 0.25s ease-out',
        'fade-in':     'fadeIn 0.3s ease-out',
        'shimmer':     'shimmer 1.6s infinite',
        'count-up':    'countUp 1.2s ease-out',
        'glow':        'glow 2s ease-in-out infinite',
      },
      keyframes: {
        slideDown: {
          '0%':   { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        glow: {
          '0%,100%': { opacity: '1' },
          '50%':     { opacity: '0.4' },
        },
      },
      boxShadow: {
        'card':  '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        'brand': '0 0 20px rgba(0,212,184,0.15)',
        'glow':  '0 0 40px rgba(0,212,184,0.08)',
      }
    },
  },
  plugins: [],
};
