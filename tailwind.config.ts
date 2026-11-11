import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#FFF3EA', 100: '#FFE4D2', 500: '#F06A25', 600: '#D9480F', 700: '#8E1B10' },
        accent: '#E8A317',
        page: '#FBF7F4',
        ink: '#2A1B16',
        danger: { 50: '#FDECEC', 600: '#B91C1C' },
        success: { 50: '#E8F5EC', 600: '#2E7D4F' },
        info: { 50: '#E6EFFA', 600: '#2563A8' },
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        arab: ['var(--font-amiri)', 'serif'],
      },
    },
  },
  plugins: [],
};
export default config;
