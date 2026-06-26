/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Using CSS variables for theme support
        theme: {
          "bg-primary": "var(--bg-primary)",
          "bg-secondary": "var(--bg-secondary)",
          "bg-card": "var(--bg-card)",
          "border": "var(--border-primary)",
          "text-primary": "var(--text-primary)",
          "text-secondary": "var(--text-secondary)",
          "text-muted": "var(--text-muted)",
        },
      },
    },
  },
  plugins: [],
};
