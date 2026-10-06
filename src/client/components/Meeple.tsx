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
      viewBox="170 35 340 340"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ verticalAlign: "middle", flexShrink: 0 }}
    >
      <path
        d="M340 50 C372 50 396 74 396 104 C396 124 386 138 376 146 C384 154 404 158 424 162 C452 160 468 170 468 188 C468 206 454 214 438 213 C428 212 420 216 416 226 C414 248 424 266 430 284 C438 304 442 322 438 340 C436 354 428 360 416 360 L372 360 C362 360 358 350 357 338 C356 328 346 322 340 322 C334 322 324 328 323 338 C322 350 318 360 308 360 L264 360 C252 360 244 354 242 340 C238 322 242 304 250 284 C256 266 266 248 264 226 C260 216 252 212 242 213 C226 214 212 206 212 188 C212 170 228 160 256 162 C276 158 296 154 304 146 C294 138 284 124 284 104 C284 74 308 50 340 50 Z"
        fill={color}
      />
    </svg>
  );
}
