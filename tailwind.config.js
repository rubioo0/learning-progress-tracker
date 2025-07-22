/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.html", "./public/**/*.js"],
  darkMode: 'class', // Enable class-based dark mode
  theme: {
    extend: {
      // Custom dark theme colors if needed
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
