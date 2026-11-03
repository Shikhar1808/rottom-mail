import type { SVGProps } from 'react';

// A handful of line icons (24px grid, 1.8 stroke), so there's no icon library to install.
const icon = (d: string) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4" {...props}>
        <path d={d} />
      </svg>
    );
  };

export const ClockIcon = icon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5V12l3 2');
export const SendIcon = icon('M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z');
export const SearchIcon = icon('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4');
export const FilterIcon = icon('M4 5h16l-6.2 7.5V19l-3.6-1.8v-4.7z');
export const RefreshIcon = icon('M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7');
export const ChevronDownIcon = icon('m6 9 6 6 6-6');
export const ArrowLeftIcon = icon('M19 12H5m6-6-6 6 6 6');
export const UploadIcon = icon('M12 15V4m-4.5 4.5L12 4l4.5 4.5M5 15v4h14v-4');
export const XIcon = icon('M6 6l12 12M18 6 6 18');

// Editor toolbar and attachments.
export const UndoIcon = icon('M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11');
export const RedoIcon = icon('m15 14 5-5-5-5m5 5H9.5a5.5 5.5 0 0 0 0 11H13');
export const AlignLeftIcon = icon('M4 6h16M4 12h10M4 18h14');
export const AlignCenterIcon = icon('M4 6h16M7 12h10M5 18h14');
export const BulletListIcon = icon('M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01');
export const NumberListIcon = icon('M10 6h10M10 12h10M10 18h10M4 4h1v4M4 8h2M4 14a1 1 0 0 1 2 0c0 1-2 1.5-2 3h2');
export const OutdentIcon = icon('M4 6h16M11 12h9M4 18h16M7 9.5 4 12l3 2.5');
export const IndentIcon = icon('M4 6h16M11 12h9M4 18h16M4 9.5 7 12l-3 2.5');
export const QuoteIcon = icon('M6 17c2 0 3-1.5 3-4V7H4v6h5m6 4c2 0 3-1.5 3-4V7h-5v6h5');
export const LinkIcon = icon('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1');
export const PaperclipIcon = icon('m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7');
export const FileIcon = icon('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5');
