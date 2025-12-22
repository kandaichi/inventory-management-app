/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-rose': '#FBCFE8',
        'brand-rose-600': '#FB7185',
        'brand-amber': '#FDE68A',
        'brand-indigo': '#C7D2FE',
      },
      fontFamily: {
        'mplus': ['"M PLUS Rounded 1c"', 'ui-sans-serif', 'system-ui'],
      }
    },
  },
  plugins: [],
}
