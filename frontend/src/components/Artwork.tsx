import { useId } from "react";
/** Native vector illustration: no screenshot-as-UI and no remote executable asset. */
export function Artwork({
  kind = "assistant",
}: {
  kind?: "assistant" | "database" | "ingestion";
}) {
  const uid = useId().replace(/:/g, "");
  const g = `blue-${uid}`,
    p = `pale-${uid}`;
  return (
    <svg
      className="hero-art"
      viewBox="0 0 480 230"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#48c5ff" />
          <stop offset=".65" stopColor="#1674ff" />
          <stop offset="1" stopColor="#0842e4" />
        </linearGradient>
        <linearGradient id={p}>
          <stop stopColor="#e9f6ff" />
          <stop offset="1" stopColor="#b0d9ff" />
        </linearGradient>
      </defs>
      <path
        d="M90 178 280 66 465 174 267 286Z"
        fill={`url(#${p})`}
        opacity=".35"
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <g
          key={i}
          opacity={0.16 + i * 0.03}
          transform={`translate(${70 + i * 73} ${55 + (i % 2) * -15})`}
        >
          <path d="m0 20 32-18 32 18v56L32 95 0 77Z" fill="#62b5ff" />
          <path
            d="m0 20 32 18 32-18M32 38v57"
            stroke="#dff5ff"
            strokeWidth="2"
          />
        </g>
      ))}
      <g transform="translate(290 41) rotate(-7)">
        <rect
          width="152"
          height="170"
          rx="12"
          fill={`url(#${p})`}
          stroke="#fff"
          strokeWidth="4"
        />
        <rect x="14" y="15" width="125" height="141" rx="6" fill="#f7fcff" />
        <path
          d="M29 53h65M29 68h43"
          stroke="#9cceff"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {[37, 68, 101].map((x, i) => (
          <rect
            key={x}
            x={x}
            y={117 - i * 24}
            width="19"
            height={28 + i * 24}
            rx="3"
            fill={`url(#${g})`}
          />
        ))}
        <path d="M29 142h99" stroke="#8ab9fa" strokeWidth="2" />
      </g>
      <g transform="translate(191 112)">
        <rect
          width="64"
          height="96"
          rx="9"
          fill={`url(#${p})`}
          stroke="white"
          strokeWidth="3"
        />
        <path
          d="M15 28h32M15 43h23M15 59h32M15 74h18"
          stroke="#73b3ff"
          strokeWidth="7"
          strokeLinecap="round"
        />
      </g>
      {kind === "assistant" ? (
        <g transform="translate(65 48)">
          <path
            d="m61 29-3-19"
            stroke="#6ba8f6"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle cx="56" cy="8" r="8" fill={`url(#${g})`} />
          <ellipse
            cx="71"
            cy="143"
            rx="51"
            ry="43"
            fill="#eaf6ff"
            stroke="#9dc5fa"
            strokeWidth="3"
          />
          <rect
            x="7"
            y="28"
            width="131"
            height="97"
            rx="47"
            fill="#f4fbff"
            stroke="#a4d1ff"
            strokeWidth="3"
          />
          <rect
            x="23"
            y="45"
            width="99"
            height="62"
            rx="28"
            fill="#0640a3"
            stroke="#168cff"
            strokeWidth="5"
          />
          <ellipse cx="53" cy="72" rx="9" ry="12" fill="#38dcff" />
          <ellipse cx="94" cy="72" rx="9" ry="12" fill="#38dcff" />
          <ellipse cx="53" cy="70" rx="4" ry="5" fill="white" />
          <ellipse cx="94" cy="70" rx="4" ry="5" fill="white" />
          <path
            d="M65 94h16"
            stroke="#43a8ff"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <ellipse
            cx="0"
            cy="78"
            rx="11"
            ry="24"
            fill={`url(#${p})`}
            stroke="#70aff8"
            strokeWidth="3"
          />
          <ellipse
            cx="145"
            cy="78"
            rx="11"
            ry="24"
            fill={`url(#${p})`}
            stroke="#70aff8"
            strokeWidth="3"
          />
          <rect
            x="51"
            y="143"
            width="39"
            height="18"
            rx="9"
            fill={`url(#${g})`}
          />
          <path
            d="m31 160-15 30m94-30 18 30"
            stroke="#c4e5ff"
            strokeWidth="17"
            strokeLinecap="round"
          />
        </g>
      ) : (
        <g transform="translate(72 59)">
          {[67, 34, 0].map((y) => (
            <g key={y}>
              <path
                d={`M0 ${y + 18}v36c0 27 122 27 122 0V${y + 18}`}
                fill={`url(#${g})`}
                stroke="#c8ecff"
                strokeWidth="3"
              />
              <ellipse
                cx="61"
                cy={y + 18}
                rx="61"
                ry="22"
                fill="#8fc8ff"
                stroke="#c8ecff"
                strokeWidth="3"
              />
              <ellipse cx="61" cy={y + 18} rx="51" ry="15" fill="#c1e8ff" />
            </g>
          ))}
          <circle
            cx="105"
            cy="108"
            r="29"
            fill="#daefff"
            stroke="#175bfa"
            strokeWidth="9"
          />
          <path
            d="m127 131 30 32"
            stroke="#175bfa"
            strokeWidth="13"
            strokeLinecap="round"
          />
        </g>
      )}
      <g transform="translate(204 15) rotate(-5)">
        <path
          d="M0 9a8 8 0 0 1 8-8h57a8 8 0 0 1 8 8v34a8 8 0 0 1-8 8H25L8 65V51a8 8 0 0 1-8-8Z"
          fill={`url(#${g})`}
          stroke="#d9efff"
          strokeWidth="3"
        />
        <path
          d="M15 18h41M15 30h25"
          stroke="#c6f0ff"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
      <path d="m262 71 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" fill="#6fb6ff" />
      <path d="m44 115 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z" fill="#6fb6ff" />
    </svg>
  );
}
export function BrandMark() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="brand-a">
          <stop stopColor="#22d3ff" />
          <stop offset="1" stopColor="#2852ff" />
        </linearGradient>
      </defs>
      <path d="m24 2 20 11.5L24 25 4 13.5Z" fill="url(#brand-a)" />
      <path d="M4 16.5 22 27v20L4 36.5Z" fill="#0aa8f8" />
      <path d="m26 27 18-10.5v20L26 47Z" fill="#2850ef" />
    </svg>
  );
}
