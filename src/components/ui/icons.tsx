import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.8,
};

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 17 17 7M9 7h8v8" {...stroke} />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" {...stroke} />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12 4.25 4.25L19 6.5" {...stroke} />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" {...stroke} />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="M12 7.5V12l3 1.75" {...stroke} />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7 7 10 10M17 7 7 17" {...stroke} />
    </Icon>
  );
}

export function CommandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 8.5h.01M15.5 8.5h.01M8.5 15.5h.01M15.5 15.5h.01" {...stroke} />
      <path d="M9 4.5h6a4.5 4.5 0 0 1 4.5 4.5v6a4.5 4.5 0 0 1-4.5 4.5H9A4.5 4.5 0 0 1 4.5 15V9A4.5 4.5 0 0 1 9 4.5Z" {...stroke} />
    </Icon>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3.75h6.5L18 8.25v12H7z" {...stroke} />
      <path d="M13.5 3.75v4.5H18M9.5 12h5M9.5 15h5" {...stroke} />
    </Icon>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 10 8-6 8 6v9.5H4z" {...stroke} />
      <path d="M9.5 19.5v-5h5v5" {...stroke} />
    </Icon>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5h16v13H4z" {...stroke} />
      <path d="M4 13h4l1.5 2h5L16 13h4" {...stroke} />
    </Icon>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 4 8 4.25-8 4.25-8-4.25zM4 12l8 4.25 8-4.25M4 15.75 12 20l8-4.25" {...stroke} />
    </Icon>
  );
}

export function LightbulbIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 16.5h7M9.5 20h5" {...stroke} />
      <path d="M8.2 13.8A6.1 6.1 0 1 1 15.8 13.8c-.75.63-1.15 1.4-1.15 2.2h-5.3c0-.8-.4-1.57-1.15-2.2Z" {...stroke} />
    </Icon>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 13.75a4 4 0 0 0 5.66.1l2-2a4 4 0 0 0-5.66-5.66l-1.15 1.14M14 10.25a4 4 0 0 0-5.66-.1l-2 2A4 4 0 0 0 12 17.81l1.15-1.14" {...stroke} />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" {...stroke} />
    </Icon>
  );
}

export function MoreHorizontalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 12h.01M12 12h.01M17.5 12h.01" {...stroke} strokeWidth={3} />
    </Icon>
  );
}

export function PaperPlaneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m20 4-7.2 16-2.7-7.3L4 10z" {...stroke} />
      <path d="M10.1 12.7 20 4" {...stroke} />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" {...stroke} />
    </Icon>
  );
}

export function PulseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12h3l1.5-5 3.5 10 2-6h2.5l1.25-3 1.25 4h2" {...stroke} />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.75" cy="10.75" r="5.75" {...stroke} />
      <path d="m15 15 4.25 4.25" {...stroke} />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" {...stroke} />
      <path d="M19.1 13.4a1.7 1.7 0 0 0 .34 1.88l.06.06-2.2 2.2-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56v.1h-3.12v-.1a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.07.06-2.2-2.2.07-.06a1.7 1.7 0 0 0 .33-1.88 1.7 1.7 0 0 0-1.55-1.03h-.1v-3.12h.1a1.7 1.7 0 0 0 1.55-1.04 1.7 1.7 0 0 0-.33-1.87l-.07-.07 2.2-2.2.07.07a1.7 1.7 0 0 0 1.87.33 1.7 1.7 0 0 0 1.04-1.55v-.1h3.12v.1a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.88-.33l.06-.07 2.2 2.2-.06.07a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.56 1.04h.1v3.12h-.1a1.7 1.7 0 0 0-1.56 1.03Z" {...stroke} />
    </Icon>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.75 19 6.5v5.25c0 4.13-2.78 7.67-7 8.5-4.22-.83-7-4.37-7-8.5V6.5z" {...stroke} />
      <path d="m8.75 12 2.1 2.1 4.45-4.45" {...stroke} />
    </Icon>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 3 1.23 4.77L18 9l-4.77 1.23L12 15l-1.23-4.77L6 9l4.77-1.23zM18.5 15l.65 2.35L21.5 18.5l-2.35.65L18.5 21l-.65-1.85-2.35-.65 2.35-.65z" {...stroke} />
    </Icon>
  );
}

export function TargetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" {...stroke} />
      <circle cx="12" cy="12" r="4" {...stroke} />
      <circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 17.5 10 12l3.5 3.5L20 8" {...stroke} />
      <path d="M14.5 8H20v5.5" {...stroke} />
    </Icon>
  );
}

export function UserGroupIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="9" r="3" {...stroke} />
      <path d="M3.75 19c.45-3 2.2-4.75 5.25-4.75s4.8 1.75 5.25 4.75M16.5 6.4a3 3 0 0 1 0 5.2M17.5 14.5c1.6.45 2.55 1.92 2.75 4.25" {...stroke} />
    </Icon>
  );
}
