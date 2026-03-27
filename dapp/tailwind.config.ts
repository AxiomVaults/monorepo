import type { Config } from 'tailwindcss'
import animatePlugin from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        axiom: {
          purple: '#e81cff',
          cyan: '#40c9ff',
          green: '#37FF8B',
          bg: '#0a0a0a',
          card: '#0f0f11',
          border: '#1a1a1e',
          muted: '#888',
        },
      },
      backgroundImage: {
        'axiom-gradient': 'linear-gradient(-45deg, #e81cff 0%, #40c9ff 100%)',
        'axiom-gradient-subtle': 'linear-gradient(-45deg, rgba(232,28,255,0.15) 0%, rgba(64,201,255,0.15) 100%)',
        'grid-dark': `linear-gradient(to right, #0f0f10 1px, transparent 1px),
                      linear-gradient(to bottom, #0f0f10 1px, transparent 1px)`,
      },
      backgroundSize: {
        grid: '1rem 1rem',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      animation: {
        'gradient-spin': 'gradient-spin 4s linear infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        'gradient-spin': {
          '0%': { transform: 'translate(-50%, -50%) rotate(0deg)' },
          '100%': { transform: 'translate(-50%, -50%) rotate(360deg)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.2' },
          '50%': { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [animatePlugin],
}

export default config
