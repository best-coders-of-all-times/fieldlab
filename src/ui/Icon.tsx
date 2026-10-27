import React from 'react';

const paths: Record<string, React.ReactNode> = {
  play: <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" stroke="none" />,
  pause: <><rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  step: <><path d="M6 5l9 7-9 7V5Z" fill="currentColor" stroke="none" /><rect x="16" y="5" width="2.5" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  reset: <><path d="M4.5 9.5A8 8 0 1 1 5.2 15" /><path d="M4.5 4.5v5h5" /></>,
  undo: <><path d="M9 7 4 12l5 5" /><path d="M4 12h9a6 6 0 0 1 6 6v1" /></>,
  redo: <><path d="m15 7 5 5-5 5" /><path d="M20 12h-9a6 6 0 0 0-6 6v1" /></>,
  camera: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z" /><circle cx="12" cy="13" r="3.5" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
  add: <><path d="M12 5v14M5 12h14" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /><path d="M10 11v6M14 11v6" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  github: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.1" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 6.1A10.6 10.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.2 3M6.2 6.6A17.8 17.8 0 0 0 2.5 12S6 18 12 18a10 10 0 0 0 4-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  charge: <><circle cx="12" cy="12" r="7" /><path d="M12 8v8M8 12h8" /></>,
  sphere: <><circle cx="12" cy="12" r="8" /><ellipse cx="12" cy="12" rx="8" ry="3" /></>,
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
  cylinder: <><ellipse cx="12" cy="5.5" rx="7" ry="2.8" /><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13" /></>,
  wire: <><path d="M3 17c4 0 4-10 9-10s5 10 9 10" /><path d="M18 4l3 3-3 3" /></>,
  loop: <><ellipse cx="12" cy="12" rx="8" ry="5" /><path d="M16 4l3 2-2 3" /></>,
  coil: <><path d="M4 12c0-2 2-3 4-3s3 2 3 4 2 3 4 2 5-2 5-5" /><path d="M4 12c0 2 2 3 4 3s3-2 3-4 2-3 4-2 5 2 5 5" /></>,
  magnet: <><path d="M6 4H3v8a9 9 0 0 0 18 0V4h-3v8a6 6 0 0 1-12 0V4Z" /><path d="M3 8h3M18 8h3" /></>,
  particle: <><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /><path d="M3 17c4-1 7-3 9-5M21 7c-4 1-7 3-9 5" /><circle cx="5" cy="18" r="1.2" fill="currentColor" stroke="none" /><circle cx="19" cy="6" r="1.2" fill="currentColor" stroke="none" /></>,
  probe: <><path d="m12 3 4 9-4 9-4-9 4-9Z" /><path d="M8 12h8" /></>,
  dielectric: <><path d="M5 4h14v16H5z" /><path d="M9 8h6M9 12h6M9 16h6" /></>,
  conductor: <><path d="M4 6h16v12H4z" /><path d="M8 6v12M16 6v12" /></>,
  wave: <><path d="M3 12c2.2 0 2.2-6 4.5-6s2.3 12 4.5 12 2.3-12 4.5-12S18.8 12 21 12" /></>,
  spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 19h16" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></>,
  grid: <><path d="M4 4h16v16H4z" /><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" /></>,
  axes: <><path d="M5 19V5M5 19h14" /><path d="m5 5 3 3M19 19l-3-3" /></>,
  chart: <><path d="M4 19V5M4 19h16" /><path d="m7 15 3-4 3 2 4-6 2 3" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" /></>,
  sliders: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--panel)" /><circle cx="15" cy="12" r="2" fill="var(--panel)" /><circle cx="7" cy="18" r="2" fill="var(--panel)" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.6 2.6 0 1 1 4.2 2.1c-1 .8-1.7 1.3-1.7 2.9M12 17.5v.1" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  orbit: <><circle cx="12" cy="12" r="3" /><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(30 12 12)" /><circle cx="20" cy="8.5" r="1.4" fill="currentColor" stroke="none" /></>,
  cursor: <><path d="m5 3 14 9-6 1 3 7-2.5 1-3-7-4 4V3Z" /></>,
  move: <><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" /></>,
  rotate: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
  scale: <><path d="M4 20 20 4M14 4h6v6M4 14v6h6" /></>,
};

export function Icon({
  name,
  size = 18,
  className = '',
  strokeWidth = 1.7,
}: {
  name: keyof typeof paths | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name] ?? paths.info}
    </svg>
  );
}
