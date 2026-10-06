/**
 * Derive a stable HSL colour from a display name.
 * Returns a CSS colour string suitable for `fill` or `color`.
 */
export function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

export const HIGHLIGHTER_PRESETS = [
  { code: "#ffe600", label: "螢光黃", name: "黃" },
  { code: "#54ff6e", label: "螢光綠", name: "綠" },
  { code: "#ff4d6d", label: "螢光紅", name: "紅" },
] as const;

/**
 * Checks if a string is a valid color code (hex, rgb, hsl, or named color)
 * and returns the normalized CSS color string, or null if invalid.
 */
export function parseColor(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // 3, 4, 6, 8 hex digits (with or without #)
  if (/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) {
    return s.startsWith("#") ? s : `#${s}`;
  }

  // Functional CSS colors like rgb(...) or hsl(...)
  if (/^(rgb|hsl)a?\(.+\)$/i.test(s)) {
    return s;
  }

  // CSS named colors
  if (/^[a-zA-Z]+$/.test(s)) {
    const lower = s.toLowerCase();
    const disallowed = ["inherit", "initial", "unset", "transparent", "currentcolor", "none"];
    if (disallowed.includes(lower)) return null;
    const css = (globalThis as unknown as { CSS?: { supports?: (prop: string, val: string) => boolean } }).CSS;
    if (typeof css !== "undefined" && typeof css.supports === "function" && css.supports("color", lower)) {
      return lower;
    }
  }

  return null;
}

export interface ParsedStatus {
  color: string | null;
  text: string;
}

/**
 * Parses a status string that may contain a color code and optional description.
 * e.g. "#54ff6e 沉思" -> { color: "#54ff6e", text: "沉思" }
 * e.g. "#54ff6e" -> { color: "#54ff6e", text: "" }
 * e.g. "沉思" -> { color: null, text: "沉思" }
 */
export function parseStatus(raw: string | undefined | null): ParsedStatus {
  if (!raw) return { color: null, text: "" };
  const s = raw.trim();
  if (!s) return { color: null, text: "" };

  // Color code at the beginning, e.g. "#54ff6e 沉思" or "#54ff6e"
  const startMatch = s.match(/^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([^\)]+\))\s*(.*)$/);
  if (startMatch) {
    const color = parseColor(startMatch[1]);
    if (color) return { color, text: startMatch[2].trim() };
  }

  // Pure hex digits without '#' at the beginning, e.g. "54ff6e 沉思" or "54ff6e"
  const hexMatch = s.match(/^([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\s*(.*)$/);
  if (hexMatch) {
    const hasSpaceAfter = s.length === hexMatch[1].length || /\s/.test(s.charAt(hexMatch[1].length));
    if (hasSpaceAfter) {
      const color = `#${hexMatch[1]}`;
      return { color, text: hexMatch[2].trim() };
    }
  }

  // Color code at the end, e.g. "沉思 #54ff6e"
  const endMatch = s.match(/^(.*?)\s+(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([^\)]+\))$/);
  if (endMatch) {
    const color = parseColor(endMatch[2]);
    if (color) return { color, text: endMatch[1].trim() };
  }

  // Pure CSS named color without extra words, e.g. "yellow"
  const singleColor = parseColor(s);
  if (singleColor && !s.includes(" ")) {
    return { color: singleColor, text: "" };
  }

  return { color: null, text: s };
}

/**
 * Combines an existing status text with a newly selected color preset.
 * e.g. if text is "沉思", selecting "#54ff6e" yields "#54ff6e 沉思".
 * e.g. if text is "#ffe600 沉思", selecting "#54ff6e" yields "#54ff6e 沉思".
 * e.g. if text is "#ffe600", selecting "#54ff6e" yields "#54ff6e".
 */
export function applyColorToStatus(currentText: string, newColor: string): string {
  const { text } = parseStatus(currentText);
  return text ? `${newColor} ${text}` : newColor;
}
