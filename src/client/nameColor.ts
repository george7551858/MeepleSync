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
