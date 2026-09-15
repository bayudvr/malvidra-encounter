/**
 * Malvidra mark — an eye whose pupil is a d20, with a 7 on its face.
 * Brand colour is "envy green" (#2f9e5b); pass `accent` to override.
 * Size it from the outside with `className` (e.g. `h-8 w-8`).
 */
export function Logo({
  className,
  accent = "#2f9e5b",
  title = "Malvidra Encounter",
}: {
  className?: string;
  accent?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id="mv-eye">
          <path d="M2 32 Q32 -5 62 32 Q32 69 2 32 Z" />
        </clipPath>
      </defs>

      <path d="M2 32 Q32 -5 62 32 Q32 69 2 32 Z" fill="#0b140f" />

      <g clipPath="url(#mv-eye)">
        <polygon
          points="32,14 46.72,22.5 46.72,39.5 32,48 17.28,39.5 17.28,22.5"
          fill={accent}
        />
        <g
          stroke="#0b140f"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        >
          <polygon points="32,14 46.72,39.5 17.28,39.5" />
          <path d="M17.28 22.5 L32 14 M17.28 22.5 L17.28 39.5 M46.72 22.5 L32 14 M46.72 22.5 L46.72 39.5 M32 48 L17.28 39.5 M32 48 L46.72 39.5" />
        </g>
        <text
          x="32"
          y="32.5"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
          fontSize="16"
          fontWeight="700"
          fill="#f5efe1"
        >
          7
        </text>
      </g>

      <path
        d="M2 32 Q32 -5 62 32 Q32 69 2 32 Z"
        fill="none"
        stroke={accent}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
