import { useId, type ReactNode } from 'react';

/** Stroke icons on a 24 grid. Decorative by default: the control that holds one carries the label. */
function Svg({ size = 16, children, sw = 1.8 }: { size?: number; children: ReactNode; sw?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };
const icon = (paths: ReactNode) => (p: P) => <Svg {...p}>{paths}</Svg>;

export const ShuffleIcon = icon(
  <>
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
    <path d="m18 2 4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4" />
  </>,
);
export const ExternalIcon = icon(<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />);
export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
);
export const CheckIcon = icon(<path d="M20 6 9 17l-5-5" />);
export const PlusIcon = icon(<path d="M5 12h14M12 5v14" />);
export const MinusIcon = icon(<path d="M5 12h14" />);
export const XIcon = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const TrashIcon = icon(<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />);
export const PlayIcon = icon(<path d="m6 3 14 9-14 9V3z" />);
export const PauseIcon = icon(
  <>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </>,
);
export const ChevronIcon = icon(<path d="m9 18 6-6-6-6" />);
export const ArrowIcon = icon(<path d="M5 12h14M13 6l6 6-6 6" />);
export const AlertIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </>,
);
export const PlugIcon = icon(<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />);
export const KeyIcon = icon(
  <>
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
  </>,
);
export const LayersIcon = icon(<path d="m12 2 10 5-10 5L2 7l10-5ZM2 12l10 5 10-5M2 17l10 5 10-5" />);
export const TargetIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </>,
);
export const CubeIcon = icon(
  <>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.3 7 12 12l8.7-5M12 22V12" />
  </>,
);
export const FlaskIcon = icon(<path d="M9 2h6M10 2v6.5L4.6 18.2A2.5 2.5 0 0 0 6.8 22h10.4a2.5 2.5 0 0 0 2.2-3.8L14 8.5V2M7 15h10" />);
export const ActivityIcon = icon(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />);
export const EyeIcon = icon(
  <>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const EyeOffIcon = icon(
  <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.6 6.6C3.6 8.6 2 12 2 12s3.6 8 10 8a9.7 9.7 0 0 0 5.4-1.6M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20" />,
);
export const CameraIcon = icon(
  <>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3.5" />
  </>,
);
export const RotateIcon = icon(<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />);
export const ResetIcon = icon(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <circle cx="12" cy="12" r="1.5" />
  </>,
);
export const GaugeIcon = icon(<path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0" />);
export const HexIcon = icon(<path d="M12 2 21 7v10l-9 5-9-5V7z" />);
export const GridIcon = icon(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>,
);
export const CpuIcon = icon(
  <>
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </>,
);
export const ClockIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </>,
);
export const BoltIcon = icon(<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />);
export const BookIcon = icon(<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />);
export const MenuIcon = icon(<path d="M4 6h16M4 12h16M4 18h16" />);
export const DownloadIcon = icon(<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />);
export const ServerIcon = icon(
  <>
    <rect x="2" y="3" width="20" height="8" rx="2" />
    <rect x="2" y="13" width="20" height="8" rx="2" />
    <path d="M6 7h.01M6 17h.01" />
  </>,
);
export const DiamondIcon = icon(<path d="M12 2 22 12 12 22 2 12z" />);
export const GhostIcon = icon(<path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />);
export const RulerIcon = icon(<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0zM14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2" />);
export const FileIcon = icon(<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />);
export const SlidersIcon = icon(<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />);
export const ChartIcon = icon(<path d="M3 3v18h18M7 16v-3M11 16V8M15 16v-5M19 16V5" />);
export const WaveIcon = icon(<path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0 2 2 2 2" />);

/** The mark: a hexagonal cell with a checking run (the diamond) at its centre, drawn in the strategy gradient. */
export function Logo({ size = 30 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false" className="logo">
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00d4ff" />
          <stop offset="1" stopColor="#2ff3a0" />
        </linearGradient>
      </defs>
      <path d="M14 3.2l9.3 5.4v10.8L14 24.8l-9.3-5.4V8.6z" fill="rgba(0,212,255,.08)" stroke={`url(#lg${id})`} strokeWidth="1.8" />
      <path d="M14 8.4l4.8 2.8v5.6L14 19.6l-4.8-2.8v-5.6z" fill="none" stroke={`url(#lg${id})`} strokeOpacity=".45" strokeWidth="1" />
      <rect x="11.4" y="11.4" width="5.2" height="5.2" rx=".8" transform="rotate(45 14 14)" fill="#fff" />
    </svg>
  );
}
