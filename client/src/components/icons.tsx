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

export const IconHome = (p: IconProps) => (
  <Icon {...p}><path d="M3 10.2 12 3l9 7.2" /><path d="M5.5 9.2V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.2" /><path d="M9.6 21v-6.2h4.8V21" /></Icon>
);
export const IconMessage = (p: IconProps) => (
  <Icon {...p}><path d="M20.5 11.6a8 8 0 0 1-11.7 7.1L4 20.4l1.7-4.7a8 8 0 1 1 14.8-4.1Z" /></Icon>
);
export const IconUsers = (p: IconProps) => (
  <Icon {...p}><circle cx="9" cy="8" r="3.4" /><path d="M2.8 20.2a6.4 6.4 0 0 1 12.4 0" /><path d="M16.4 5.1a3.2 3.2 0 0 1 0 6.2" /><path d="M17.6 14.6a5.6 5.6 0 0 1 3.6 5.2" /></Icon>
);
export const IconCompass = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m15.4 8.6-2 5-5 2 2-5 5-2Z" /></Icon>
);
export const IconBell = (p: IconProps) => (
  <Icon {...p}><path d="M18 8.6a6 6 0 1 0-12 0c0 4-1.6 5.4-2.3 6.1-.4.4-.1 1.1.4 1.1h15.8c.5 0 .8-.7.4-1.1-.7-.7-2.3-2.1-2.3-6.1Z" /><path d="M9.6 19.2a2.6 2.6 0 0 0 4.8 0" /></Icon>
);
export const IconSettings = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="3.1" /><path d="M19.2 14.4a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.3a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2.5a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 2.9-1.2V2.5a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.3a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1.1Z" /></Icon>
);
export const IconSearch = (p: IconProps) => (
  <Icon {...p}><circle cx="10.6" cy="10.6" r="6.6" /><path d="m20 20-4.4-4.4" /></Icon>
);
export const IconPlus = (p: IconProps) => (<Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>);
export const IconClose = (p: IconProps) => (<Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>);
export const IconCheck = (p: IconProps) => (<Icon {...p}><path d="m4.5 12.5 5 5L20 6.8" /></Icon>);
export const IconLogout = (p: IconProps) => (
  <Icon {...p}><path d="M15 4h3.2A1.8 1.8 0 0 1 20 5.8v12.4A1.8 1.8 0 0 1 18.2 20H15" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h9.5" /></Icon>
);
export const IconMic = (p: IconProps) => (
  <Icon {...p}><rect x="9" y="2.6" width="6" height="11" rx="3" /><path d="M5.5 11.4a6.5 6.5 0 0 0 13 0" /><path d="M12 17.9V21" /></Icon>
);
export const IconMicOff = (p: IconProps) => (
  <Icon {...p}><path d="M9 6.2V5.6a3 3 0 0 1 6 0v5.6" /><path d="M9 10.6v3a3 3 0 0 0 4.6 2.6" /><path d="M5.5 11.4a6.5 6.5 0 0 0 9.3 5.9" /><path d="M12 17.9V21" /><path d="m3 3 18 18" /></Icon>
);
export const IconHeadphones = (p: IconProps) => (
  <Icon {...p}><path d="M4 14.5v-2.3a8 8 0 0 1 16 0v2.3" /><rect x="2.6" y="13.4" width="4.2" height="6.4" rx="2.1" /><rect x="17.2" y="13.4" width="4.2" height="6.4" rx="2.1" /></Icon>
);
export const IconHeadphonesOff = (p: IconProps) => (
  <Icon {...p}><path d="M4 14.5v-2.3a8 8 0 0 1 12.4-6.7" /><path d="M20 12.2v2.3" /><rect x="2.6" y="13.4" width="4.2" height="6.4" rx="2.1" /><rect x="17.2" y="13.4" width="4.2" height="6.4" rx="2.1" /><path d="m3 3 18 18" /></Icon>
);
export const IconUser = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="8" r="3.8" /><path d="M4.4 20.4a7.6 7.6 0 0 1 15.2 0" /></Icon>
);
export const IconShield = (p: IconProps) => (
  <Icon {...p}><path d="M12 2.8 20 6v6.2c0 4.6-3.3 7.8-8 9-4.7-1.2-8-4.4-8-9V6l8-3.2Z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></Icon>
);
export const IconCrown = (p: IconProps) => (
  <Icon {...p}><path d="M3.4 8.2 7.6 11 12 5l4.4 6 4.2-2.8-1.7 9.3H5.1L3.4 8.2Z" /><path d="M5.4 20.4h13.2" /></Icon>
);
export const IconLock = (p: IconProps) => (
  <Icon {...p}><rect x="4.4" y="10.2" width="15.2" height="10.4" rx="2.4" /><path d="M8 10.2V7.6a4 4 0 0 1 8 0v2.6" /><path d="M12 14.4v2.4" /></Icon>
);
export const IconMail = (p: IconProps) => (
  <Icon {...p}><rect x="2.8" y="5" width="18.4" height="14" rx="2.6" /><path d="m3.6 7 8.4 6 8.4-6" /></Icon>
);
export const IconCamera = (p: IconProps) => (
  <Icon {...p}><rect x="2.6" y="6.4" width="13" height="11.2" rx="2.4" /><path d="m15.6 12 5.8-3.4v6.8L15.6 12Z" /></Icon>
);
export const IconMonitor = (p: IconProps) => (
  <Icon {...p}><rect x="2.6" y="4" width="18.8" height="12.4" rx="2" /><path d="M9 20.2h6M12 16.4v3.8" /></Icon>
);
export const IconChevronDown = (p: IconProps) => (<Icon {...p}><path d="m6 9.5 6 6 6-6" /></Icon>);
export const IconChevronRight = (p: IconProps) => (<Icon {...p}><path d="m9.5 6 6 6-6 6" /></Icon>);
export const IconChevronLeft = (p: IconProps) => (<Icon {...p}><path d="m14.5 6-6 6 6 6" /></Icon>);
export const IconMenu = (p: IconProps) => (<Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>);
export const IconPalette = (p: IconProps) => (
  <Icon {...p}><path d="M12 21a9 9 0 1 1 9-9c0 2.4-2 3.4-3.6 3.4h-1.7a2 2 0 0 0-1.4 3.4c.5.6.2 1.6-.6 1.8-.5.2-1.1.4-1.7.4Z" /><circle cx="8.2" cy="10.4" r="1.1" fill="currentColor" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" /><circle cx="15.8" cy="9.8" r="1.1" fill="currentColor" /></Icon>
);
export const IconSparkle = (p: IconProps) => (
  <Icon {...p}><path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2 10.3 12.4 4.5 10.7 10.3 9 12 3.2Z" /><path d="M18.6 16.4l.7 2.2 2.2.7-2.2.7-.7 2.2-.7-2.2-2.2-.7 2.2-.7.7-2.2Z" /></Icon>
);
export const IconTrash = (p: IconProps) => (
  <Icon {...p}><path d="M4.4 7h15.2" /><path d="M9.4 7V5.2a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4V7" /><path d="M6.4 7l.9 12.2a1.8 1.8 0 0 0 1.8 1.6h5.8a1.8 1.8 0 0 0 1.8-1.6L17.6 7" /></Icon>
);
export const IconUpload = (p: IconProps) => (
  <Icon {...p}><path d="M12 16.4V4.6" /><path d="m7.4 9.2 4.6-4.6 4.6 4.6" /><path d="M4.4 15.6v2.6a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-2.6" /></Icon>
);
export const IconGlobe = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M3.2 12h17.6" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" /></Icon>
);
export const IconInfo = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.4" /><circle cx="12" cy="7.9" r="1" fill="currentColor" /></Icon>
);
export const IconWarning = (p: IconProps) => (
  <Icon {...p}><path d="M12 3.6 21 19.4H3L12 3.6Z" /><path d="M12 9.6v4.2" /><circle cx="12" cy="16.6" r="1" fill="currentColor" /></Icon>
);
export const IconPhone = (p: IconProps) => (
  <Icon {...p}><path d="M6.4 3.6h2.7l1.6 4-2 1.4a10.6 10.6 0 0 0 5.1 5.1l1.4-2 4 1.6v2.7a2.6 2.6 0 0 1-2.8 2.6C10.1 18.4 5.6 13.9 4.8 6.4a2.6 2.6 0 0 1 1.6-2.8Z" /></Icon>
);
export const IconPin = (p: IconProps) => (
  <Icon {...p}><path d="M12 21v-6.4" /><path d="M8.4 3.4h7.2l-.8 5.2 3 3.2H6.2l3-3.2-.8-5.2Z" /></Icon>
);
export const IconAt = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M16 8v4.6a2.9 2.9 0 0 0 5.6 1.2A9.2 9.2 0 1 0 18.6 19" /></Icon>
);
