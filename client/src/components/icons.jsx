/**
 * Inline SVG icon set.
 *
 * Inline (rather than an icon package) keeps the bundle small and lets icons
 * inherit `currentColor` for free. Every icon is 24x24 with a 1.8-2 stroke.
 */

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

export function HomeIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function ChatIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M20 12.5a7.5 7.5 0 0 1-10.9 6.7L4.5 20l1-4A7.5 7.5 0 1 1 20 12.5Z" />
      <path d="M8.8 12h.01M12 12h.01M15.2 12h.01" strokeWidth="2.4" />
    </svg>
  );
}

export function SettingsIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M4.9 7.8l1.8 1M17.3 15.2l1.8 1M4.9 16.2l1.8-1M17.3 8.8l1.8-1" />
    </svg>
  );
}

export function ShieldIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 5.5 6v5.2c0 4 2.7 7.4 6.5 9.3 3.8-1.9 6.5-5.3 6.5-9.3V6L12 3.5Z" />
      <path d="m9.3 12 1.9 1.9 3.6-3.7" />
    </svg>
  );
}

export function InfoIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2M12 7.9h.01" />
    </svg>
  );
}

export function SendIcon(props) {
  return (
    <svg {...base} {...props} strokeWidth="2" width={20} height={20}>
      <path d="M5 12.5 19.5 5l-6.2 14.3-1.9-5.3-6.4-1.5Z" />
    </svg>
  );
}

export function ArrowLeftIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

export function ChevronRightIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9.5 6 16 12l-6.5 6" />
    </svg>
  );
}

export function TrashIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" />
      <path d="M7 7l.8 11a1.5 1.5 0 0 0 1.5 1.4h5.4A1.5 1.5 0 0 0 16.2 18L17 7" />
      <path d="M10.5 10.5v5.5M13.5 10.5v5.5" />
    </svg>
  );
}

export function RefreshIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M19 12a7 7 0 1 1-2.1-5" />
      <path d="M19 4.5V9h-4.5" />
    </svg>
  );
}

export function StopIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="7.5" y="7.5" width="9" height="9" rx="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SparkleIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4.5l1.6 4.1 4.1 1.6-4.1 1.6L12 16l-1.6-4.2L6.3 10.2l4.1-1.6L12 4.5Z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
    </svg>
  );
}

export function HeartIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 19s-6.5-4-6.5-8.3A3.7 3.7 0 0 1 12 8.2a3.7 3.7 0 0 1 6.5 2.5C18.5 15 12 19 12 19Z" />
    </svg>
  );
}

export function ClockIcon(props) {
  return (
    <svg {...base} {...props} width={16} height={16}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 8v4.4l2.6 1.6" />
    </svg>
  );
}

export function WifiOffIcon(props) {
  return (
    <svg {...base} {...props} width={18} height={18}>
      <path d="M4 9.2a12 12 0 0 1 6-3.1M20 9.2a12 12 0 0 0-3.3-2.3" />
      <path d="M7.5 12.6a8 8 0 0 1 2.3-.9M16.5 12.6a8 8 0 0 0-1.3-.7" />
      <path d="M12 16.4h.01M4.5 4.5l15 15" />
    </svg>
  );
}

export function ArrowDownIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5.5V18M6.5 12.5 12 18l5.5-5.5" />
    </svg>
  );
}

export function AlertIcon(props) {
  return (
    <svg {...base} {...props} width={18} height={18}>
      <path d="M12 4.8 20 19H4l8-14.2Z" />
      <path d="M12 10.5v3.6M12 16.6h.01" />
    </svg>
  );
}
