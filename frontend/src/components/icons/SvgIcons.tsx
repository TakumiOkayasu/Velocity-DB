import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

// ====================================================================
// ToolbarIcons — MainLayout 上部ツールバー用 (16x16, 視覚的に太め)
// ====================================================================
export const ToolbarIcons = {
  Database: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <ellipse cx="8" cy="4" rx="6" ry="2.5" />
      <path d="M2 4v8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V4" />
      <path d="M2 8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" />
    </svg>
  ),
  Play: (props: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M4 2v12l10-6-10-6z" />
    </svg>
  ),
  Stop: (props: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <rect x="3" y="3" width="10" height="10" rx="1" />
    </svg>
  ),
  Format: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 3h12M2 6h8M2 9h12M2 12h8" />
    </svg>
  ),
  Sidebar: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M6 2v12" />
    </svg>
  ),
  Terminal: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 10h12" />
    </svg>
  ),
  Search: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </svg>
  ),
  Settings: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" />
    </svg>
  ),
  Compare: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <rect x="1.5" y="2.5" width="5" height="11" rx="1" />
      <rect x="9.5" y="2.5" width="5" height="11" rx="1" />
      <path d="M6.5 6h3M9.5 10h-3" />
    </svg>
  ),
};

// ====================================================================
// TreeIcons — TreeNode 用 (16x16、細め。Toolbar と同名でも形状は別)
// ====================================================================
export const TreeIcons = {
  Database: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
    </svg>
  ),
  Folder: (props: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M2 3.5A1.5 1.5 0 013.5 2h2.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.622 4H12.5A1.5 1.5 0 0114 5.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" />
    </svg>
  ),
  FolderOpen: (props: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M1.5 13.25V3.5A1.5 1.5 0 013 2h3.379a1.5 1.5 0 011.06.44l.94.94a.5.5 0 00.354.147H13.5A1.5 1.5 0 0115 5v.5H2V3.5a.5.5 0 01.5-.5h3.379a.5.5 0 01.354.146l.94.94A1.5 1.5 0 008.233 4.5H13.5a.5.5 0 01.5.5v.5H2v7.75a.75.75 0 00.75.75h10.5a.75.75 0 00.75-.75V6h1v7.25a1.75 1.75 0 01-1.75 1.75H2.75a1.75 1.75 0 01-1.25-2z" />
    </svg>
  ),
  Table: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 5h12M2 8h12M2 11h12M6 5v9M10 5v9" />
    </svg>
  ),
  View: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2.5" />
    </svg>
  ),
  Column: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 4v8M8 8h4" />
    </svg>
  ),
  Key: (props: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M5.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm0-1a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
      <path d="M7.5 6.5h6v1h-6z" />
      <path d="M11.5 6.5v3h-1v-3zM13.5 6.5v2h-1v-2z" />
    </svg>
  ),
  Loading: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
    </svg>
  ),
  ChevronRight: (props: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M6 4l4 4-4 4" />
    </svg>
  ),
  ChevronDown: (props: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  ),
};

// ====================================================================
// TabIcons — EditorTabs 用 (16x16、細め)
// ====================================================================
export const TabIcons = {
  Sql: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
      <path d="M9 1v4h4" />
    </svg>
  ),
  ERDiagram: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
      {...props}
    >
      <rect x="1" y="1" width="5" height="4" rx="0.5" />
      <rect x="10" y="1" width="5" height="4" rx="0.5" />
      <rect x="5.5" y="11" width="5" height="4" rx="0.5" />
      <path d="M3.5 5v3.5h4.5V11" />
      <path d="M12.5 5v3.5h-4.5V11" />
    </svg>
  ),
  Plus: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  Close: (props: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
};
