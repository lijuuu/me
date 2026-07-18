/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./_projects/**/*.md",
    "./index.html",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Caveat"', "cursive"],
      },
      colors: {
        accent: {
          DEFAULT: "#6B9FFF",
          dark: "#5B8FEF",
          muted: "rgb(107 159 255 / 0.15)",
          "muted-dark": "rgb(91 143 239 / 0.15)",
        },
      },
    },
  },
  plugins: [],
};
