/** A deliberately small set of tokens; enough for P6.2/P6.3's screens. */
export const theme = {
  colour: {
    background: "#0b1220",
    surface: "#141d2e",
    border: "#243147",
    text: "#f5f7fa",
    muted: "#94a3b8",
    accent: "#22c55e",
    danger: "#f87171",
    /** The SG-9 safeguarding banner and anything else that must be noticed. */
    warning: "#fbbf24",
    /** Own messages in a thread. */
    mine: "#1d4ed8",
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 6, md: 10, lg: 16 },
} as const;
