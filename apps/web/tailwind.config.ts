import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // The three states that are not danger. `tint` is the wash a chip or
        // callout sits on, DEFAULT is the ink that reads on it, `foreground`
        // is the text for the rare solid fill. Defined in globals.css for
        // :root, .dark and .theme-ink, so a status keeps its meaning inside
        // the dark crest rail.
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          tint: "hsl(var(--success-tint))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          tint: "hsl(var(--warning-tint))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          tint: "hsl(var(--info-tint))",
        },
      },
      // Four sizes named for what they label, filling the gaps Tailwind's
      // stock scale leaves between 12px and 20px. The app had drifted to 16
      // distinct `text-[Npx]` literals — 11px, 12.5px, 13px, 15px, 17px and
      // so on — which is a scale nobody agreed to and nothing can enforce.
      // With stock xs/sm/lg/xl these four absorb all of them: `2xs` for a
      // micro-label over a tile, `list` for a dense row of data, `row` for a
      // card's own line of text, `panel` for the heading of a sheet or a
      // figure on a stat tile. Landing on a named size sometimes shifts a
      // number by half a pixel; that is the point.
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
        list: ["0.8125rem", { lineHeight: "1.125rem" }],
        row: ["0.9375rem", { lineHeight: "1.25rem" }],
        panel: ["1.0625rem", { lineHeight: "1.375rem" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config;
