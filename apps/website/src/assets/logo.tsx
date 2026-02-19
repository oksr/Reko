import { cn } from "@/lib/utils"

interface LogoProps {
  className?: string
  size?: number
}

export function Logo({ className, size = 28 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="32" height="32" rx="8" fill="oklch(0.269 0 0)" />
      <circle cx="16" cy="16" r="8" fill="#ef4444" />
    </svg>
  )
}

export function LogoWithText({ className }: { className?: string }) {
  return (
    <a href="#" className={cn("flex items-center gap-2.5", className)}>
      <Logo />
      <span className="text-lg font-semibold tracking-tight">Reko</span>
    </a>
  )
}
