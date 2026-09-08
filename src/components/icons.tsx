"use client";

import type { SVGProps } from "react";
import type { ChallengeMeta } from "@/game/types";
import type { Role } from "@/game/types";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** One consistent stroke icon system for roles — replaces emoji stand-ins. */
export function RoleIcon({ role, ...props }: { role: Role } & IconProps) {
  switch (role) {
    case "lhand":
      return (
        <Base {...props}>
          <path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V10m0-4.5v-1a1.5 1.5 0 0 1 3 0V10m0-4a1.5 1.5 0 0 1 3 0v7m0-3a1.5 1.5 0 0 1 3 0v4c0 3.5-2.5 6-6 6-2.7 0-4.2-1-5.6-3.2L4.6 13c-.7-1 .1-2.3 1.3-2.1L7 11.2" />
        </Base>
      );
    case "rhand":
      return (
        <Base {...props}>
          <path d="M17 11V6.5a1.5 1.5 0 0 0-3 0V10m0-4.5v-1a1.5 1.5 0 0 0-3 0V10m0-4a1.5 1.5 0 0 0-3 0v7m0-3a1.5 1.5 0 0 0-3 0v4c0 3.5 2.5 6 6 6 2.7 0 4.2-1 5.6-3.2l2.8-3.8c.7-1-.1-2.3-1.3-2.1L17 11.2" />
        </Base>
      );
    case "arms":
      return (
        <Base {...props}>
          <path d="M12 4v5m0 0-4.5 3.5M12 9l4.5 3.5M8.5 6.5 4 10m16-3.5L15.5 10M4 10l-1.5 5m19-5L23 15M7 21l3-4m7 4-3-4" />
          <circle cx="12" cy="4" r="1.6" />
        </Base>
      );
    case "torso":
      return (
        <Base {...props}>
          <path d="M12 3.5c-2.8 0-4.5 1.2-4.5 3.5l1 7.5c.3 2 1.6 3 3.5 3s3.2-1 3.5-3l1-7.5c0-2.3-1.7-3.5-4.5-3.5Z" />
          <path d="M12 8.5v4m-2.5 5.5L12 20l2.5-1.5" />
        </Base>
      );
    case "head":
      return (
        <Base {...props}>
          <circle cx="12" cy="9" r="5" />
          <path d="M10 9h.01M14 9h.01M12 20v-6" />
        </Base>
      );
    case "lleg":
      return (
        <Base {...props}>
          <path d="M10 3.5h4M11 3.5V11l-3.5 6.5M11 11l3 3.5V21" />
          <path d="M8 21h6" />
        </Base>
      );
    case "rleg":
      return (
        <Base {...props}>
          <path d="M10 3.5h4M13 3.5V11l3.5 6.5M13 11l-3 3.5V21" />
          <path d="M10 21h6" />
        </Base>
      );
    case "legs":
    default:
      return (
        <Base {...props}>
          <path d="M9 3.5h6M9.5 3.5V11L6 21m3.5-10L13 21M14.5 3.5V11L18 21" />
        </Base>
      );
  }
}

/** One consistent stroke icon system for challenges — replaces emoji stand-ins. */
export function ChallengeIcon({ challenge, ...props }: { challenge: Pick<ChallengeMeta, "id"> } & IconProps) {
  switch (challenge.id) {
    case "ferry-job":
      return (
        <Base {...props}>
          <path d="M4 15.5h16l-1.8 4H5.8L4 15.5Z" />
          <path d="M8 15.5v-5h8v5M8 12.5H5.5M16 12.5h2.5M7 8.5h10v4" />
        </Base>
      );
    case "summit-sync":
      return (
        <Base {...props}>
          <path d="M3.5 19.5 10 6l3.5 6 2-3.5L20.5 19.5h-17Z" />
          <path d="M10 6l-1.5 3M13.5 12l1 2" />
        </Base>
      );
    case "egg-express":
      return (
        <Base {...props}>
          <path d="M12 3.5c3 0 5.5 4.6 5.5 9a5.5 5.5 0 0 1-11 0c0-4.4 2.5-9 5.5-9Z" />
          <path d="M9.5 12.5c.5 1.8 1.5 2.7 3 3" />
        </Base>
      );
    case "slam-dunk":
      return (
        <Base {...props}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4v16M4 12h16M5.5 7.5c3 2.5 10 2.5 13 0M5.5 16.5c3-2.5 10-2.5 13 0" />
        </Base>
      );
    case "wobble-run":
    default:
      return (
        <Base {...props}>
          <path d="M6 21V4m0 .5h11l-2.5 3.5L17 11.5H6" />
          <path d="M4 21h4" />
        </Base>
      );
  }
}

export function CopyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </Base>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Base>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19 12H5m6-7-7 7 7 7" />
    </Base>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 21V4m0 1h11l-2.5 3.5L17 12H6" />
    </Base>
  );
}

export function RotateIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 10a8 8 0 1 1-1 6" />
      <path d="M4 4v6h6" />
    </Base>
  );
}

export function SoundOnIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 10v4h3l4 3.5v-11L7 10H4Z" />
      <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" />
    </Base>
  );
}

export function SoundOffIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 10v4h3l4 3.5v-11L7 10H4Z" />
      <path d="m15 10 5 5m0-5-5 5" />
    </Base>
  );
}
