// Colours and icons shared by the page and the stage. One class keeps one colour everywhere
// (stage, timeline, bars, chips). The four hues are categorical slots 1-4 of the validated
// dark palette, in order; "other" is the neutral catch-all, and the no-limits baseline uses
// the reserved critical colour and always carries its label.

export const CLASS_ORDER = ['search', 'install', 'edit', 'test', 'other'] as const;

export type IconName = 'search' | 'package' | 'pencil' | 'flask' | 'terminal' | 'unlock' | 'check' | 'x' | 'disk' | 'globe' | 'key'
  | 'server' | 'shield' | 'play' | 'pause' | 'warning' | 'cpu' | 'bot' | 'filter' | 'grid' | 'replay' | 'bolt' | 'chevron' | 'clock' | 'ban';

export const CLASS_META: Record<string, { color: string; label: string; blurb: string; icon: IconName }> = {
  search: { color: '#3987e5', label: 'search', blurb: 'The web search tool', icon: 'search' },
  install: { color: '#d95926', label: 'install', blurb: 'Dependency installs', icon: 'package' },
  edit: { color: '#199e70', label: 'edit', blurb: 'The file-writing tool', icon: 'pencil' },
  test: { color: '#c98500', label: 'test', blurb: 'Test runs', icon: 'flask' },
  other: { color: '#898781', label: 'other', blurb: 'Every other command', icon: 'terminal' },
  open: { color: '#d03b3b', label: 'no limits', blurb: 'A conventional sandbox (baseline)', icon: 'unlock' },
};
export const classMeta = (name: string | undefined) => CLASS_META[name ?? ''] ?? CLASS_META.other;

export const INK = {
  page: '#0d0d0d', surface: '#1a1a19', raised: '#222220', line: '#2c2c2a', axis: '#383835',
  primary: '#f0efec', secondary: '#c3c2b7', muted: '#898781',
  good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', accent: '#3987e5',
};

const PATHS: Record<IconName, string[]> = {
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
  package: ['M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z', 'M4 7.5l8 4.5 8-4.5', 'M12 12v9'],
  pencil: ['M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1z', 'M14 7l3 3'],
  flask: ['M9 3h6', 'M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3', 'M7.5 15h9'],
  terminal: ['M4 5h16v14H4z', 'M8 10l3 2.5L8 15', 'M13 15h3'],
  unlock: ['M6 11h12v9H6z', 'M8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  disk: ['M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z', 'M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6', 'M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.500 5.5 12 3z'],
  key: ['M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M11 12.5L20 4', 'M16.5 7.5L19 10', 'M14 10l2 2'],
  server: ['M4 5h16v6H4z', 'M4 13h16v6H4z', 'M7.5 8h.01', 'M7.5 16h.01'],
  shield: ['M12 3l7 3v5.500c0 4.300-2.900 7.700-7 9.500-4.100-1.800-7-5.200-7-9.500V6l7-3z', 'M9 12l2.200 2.200L15.200 10'],
  play: ['M8 5.500v13l11-6.500-11-6.500z'],
  pause: ['M8 5v14', 'M16 5v14'],
  warning: ['M12 4l9 16H3l9-16z', 'M12 10v4.500', 'M12 17.300h.01'],
  cpu: ['M7 7h10v10H7z', 'M10 3v4', 'M14 3v4', 'M10 17v4', 'M14 17v4', 'M3 10h4', 'M3 14h4', 'M17 10h4', 'M17 14h4'],
  bot: ['M6 9h12v10H6z', 'M12 9V5', 'M12 5h.01', 'M9.500 13.500h.01', 'M14.500 13.500h.01', 'M3.500 13v3', 'M20.500 13v3'],
  filter: ['M4 5h16l-6 7.500V19l-4-2v-4.500L4 5z'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  replay: ['M4.500 12a7.500 7.500 0 1 0 2.400-5.500', 'M4 4.500V9h4.500'],
  bolt: ['M13 3L5 13.500h6L10 21l8-10.500h-6L13 3z'],
  chevron: ['M9 6l6 6-6 6'],
  clock: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M12 8v4.500l3 1.800'],
  ban: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M6.500 6.500l11 11'],
};

export function Icon({ name, size = 16, color = 'currentColor', stroke = 1.8, style }: { name: IconName; size?: number; color?: string; stroke?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', ...style }}>
      {PATHS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
