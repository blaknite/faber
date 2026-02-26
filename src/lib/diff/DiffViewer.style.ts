// Color scheme matching the existing DiffView conventions
export const colors = {
  add: "#00cc66",
  remove: "#cc3333",
  header: "#559999",
  meta: "#888888",
  context: "#666666",
  lineNum: "#444444",
  // Highlight variants -- slightly brighter for character-level changes
  addHighlight: "#004d27",
  removeHighlight: "#4d0f0f",
  // Row-level background for whole add/remove lines
  addRow: "#002914",
  removeRow: "#2e0b0b",
  // UI chrome
  border: "#555555",
  background: "#000000",
  chrome: "#222222",
  modeActive: "#0088ff",
  modeInactive: "#555555",
  separator: "#333333",
} as const

export const layout = {
  lineNumWidth: 4,
  sideBySidePadding: 1,
} as const

// Common box styles
export const styles = {
  root: {
    flexDirection: "column" as const,
    flexGrow: 1,
    paddingBottom: 1,
  },
  header: {
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    paddingBottom: 1,
    backgroundColor: colors.chrome,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
  },
  scrollArea: {
    flexGrow: 1,
    paddingLeft: 2,
    paddingRight: 2,
    paddingBottom: 1,
    overflow: "hidden" as const,
  },
  scrollContent: {
    flexDirection: "column" as const,
  },
  hunkHeader: {
    paddingLeft: 1,
    paddingTop: 1,
    paddingBottom: 0,
  },
  fileHeader: {
    paddingLeft: 1,
    paddingTop: 1,
    paddingBottom: 0,
  },
  // Side-by-side: the two columns sit inside a row
  sideBySideRow: {
    flexDirection: "row" as const,
    flexGrow: 1,
  },
  sideBySideColumn: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "column" as const,
    overflow: "hidden" as const,
  },
} as const
