import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dcecff',
          200: '#bdd9ff',
          300: '#90c0ff',
          400: '#669fff',
          500: '#3d7cf4',
          600: '#2864dd',
          700: '#2250b4',
          800: '#203f8c',
          900: '#20386f',
          950: '#16264d',
        },
        surface: {
          DEFAULT: '#09101f',
          raised: '#101a2d',
          border: '#25324d',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
