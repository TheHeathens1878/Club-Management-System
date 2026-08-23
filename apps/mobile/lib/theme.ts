/** A deliberately small set of tokens; the design system lands with P6.2. */
export const theme = {
  colour: {
    background: "#0b1220",
    surface: "#141d2e",
    border: "#243147",
    text: "#f5f7fa",
    muted: "#94a3b8",
    accent: "#22c55e",
    danger: "#f87171",
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { md: 10, lg: 16 },
} as const;
