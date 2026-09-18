/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          purple: '#3B1F8C',
          'purple-light': '#5A3DB5',
          'purple-dark': '#2A1566',
          teal: '#00C9A7',
          'teal-mid': '#00A3BF',
          'teal-dark': '#007DA6',
          gray: '#6B7280',
        }
      },
      fontFamily: {
        // The --font-geist-* variables are not defined anywhere in the app. A
        // bare var() with no fallback makes the whole font-family declaration
        // invalid, so `font-mono` silently inherited the sans face and code
        // blocks lost their alignment. The in-var() fallback keeps the hook for
        // a future next/font setup while guaranteeing a real stack today.
        sans: ['var(--font-geist-sans, system-ui)', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-geist-mono, ui-monospace)', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #3B1F8C 0%, #5A3DB5 50%, #007DA6 100%)',
        'teal-gradient': 'linear-gradient(90deg, #00C9A7, #007DA6)',
        'speed-lines': 'linear-gradient(90deg, #00C9A7 0%, #007DA6 50%, #3B1F8C 100%)',
      },
      animation: {
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      }
    },
  },
  plugins: [],
}
