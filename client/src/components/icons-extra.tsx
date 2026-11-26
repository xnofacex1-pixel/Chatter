import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconSend = (p: IconProps) => (
  <Icon {...p}><path d="M4.2 11.4 20 4l-6.4 16-2.4-6.2-6.9-2.4Z" /><path d="m11.2 13.8 3.6-3.6" /></Icon>
);
export const IconPaperclip = (p: IconProps) => (
  <Icon {...p}><path d="M20 11.6 12.4 19a4.6 4.6 0 0 1-6.5-6.5l7.7-7.6a3.1 3.1 0 0 1 4.4 4.4l-7.7 7.6a1.6 1.6 0 0 1-2.2-2.2l7-6.9" /></Icon>
);
export const IconSmile = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.6" /><path d="M8.6 14.2a4.2 4.2 0 0 0 6.8 0" /><path d="M9.2 9.6h.01M14.8 9.6h.01" /></Icon>
);
export const IconEdit = (p: IconProps) => (
  <Icon {...p}><path d="M4 20h4.2L20 8.2a2.2 2.2 0 0 0-3.1-3.1L5 16.8 4 20Z" /><path d="m15.2 6.6 3.1 3.1" /></Icon>
);
export const IconReply = (p: IconProps) => (
  <Icon {...p}><path d="M9.4 6.6 4 11.4l5.4 4.8" /><path d="M4 11.4h9.6a5.8 5.8 0 0 1 5.8 5.8v1.2" /></Icon>
);
export const IconMore = (p: IconProps) => (
  <Icon {...p}><circle cx="5.4" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18.6" cy="12" r="1.4" /></Icon>
);
export const IconDownload = (p: IconProps) => (
  <Icon {...p}><path d="M12 4v11" /><path d="m7.6 10.8 4.4 4.4 4.4-4.4" /><path d="M4.6 19.4h14.8" /></Icon>
);
export const IconBan = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.6" /><path d="m6.2 6.2 11.6 11.6" /></Icon>
);
export const IconArchive = (p: IconProps) => (
  <Icon {...p}><path d="M3.6 7.4h16.8v3.2H3.6z" /><path d="M5.2 10.6V20h13.6v-9.4" /><path d="M10 14.2h4" /></Icon>
);
