import { nameToColor } from "../nameColor";

/**
 * A solid-colour meeple SVG icon.
 * The colour is derived deterministically from `name`.
 */
export function Meeple({ name, size = 20 }: { name: string; size?: number }) {
  const color = nameToColor(name);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ verticalAlign: "middle", flexShrink: 0 }}
    >
      {/* Head */}
      <circle cx="50" cy="22" r="14" fill={color} />
      {/* Body: torso + arms + legs as a single path */}
      <path
        d="M50 36 C36 36 28 48 20 60 L14 72 Q12 76 16 78 L30 78 Q34 78 34 74 L38 62 L38 92 Q38 96 42 96 L46 96 L46 62 L54 62 L54 96 L58 96 Q62 96 62 92 L62 62 L66 74 Q66 78 70 78 L84 78 Q88 76 86 72 L80 60 C72 48 64 36 50 36 Z"
        fill={color}
      />
    </svg>
  );
}
