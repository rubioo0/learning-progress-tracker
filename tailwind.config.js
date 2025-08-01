/** @type {import('tailwindcss').Config} */

module.exports = {
  content: ["./public/**/*.html", "./public/**/*.js"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        gray: {
          850: '#1f2937',
          950: '#111827',
        }
      }
    },
  },
  plugins: [],
}
