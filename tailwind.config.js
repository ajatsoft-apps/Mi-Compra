/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#f0f5ec', 100: '#dce9d3', 500: '#668c55', 600: '#527443', 700: '#405b35' },
        ink: '#243126',
        paper: '#f7f8f4',
      },
      boxShadow: { soft: '0 12px 35px rgba(36, 49, 38, 0.08)' },
    },
  },
  plugins: [],
}
