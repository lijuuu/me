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
        mono: ['"IBM Plex Mono"', "monospace"],
      },
      colors: {
        accent: {
          DEFAULT: "#e06b20",
          dark: "#f0853f",
          muted: "rgb(224 107 32 / 0.15)",
          "muted-dark": "rgb(240 133 63 / 0.15)",
        },
      },
    },
  },
  plugins: [],
};
