import type { ComponentType, ReactNode, SVGProps } from "react";

/** Props shared by every icon component the app renders, kit or lucide. */
export interface IconProps {
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
  role?: string;
  focusable?: boolean | "true" | "false" | "auto";
}

/** An icon component: a generated kit icon or a lucide icon. Both accept IconProps. */
export type IconComponent = ComponentType<IconProps>;

export type KitIconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & { size?: number | string };

/** The 24 x 24 frame every kit icon draws in: currentColor, 1.5 stroke, round caps. */
export function KitIcon({ size = 24, strokeWidth = 1.5, children, ...rest }: KitIconProps & { children: ReactNode }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {children}
    </svg>
  );
}
