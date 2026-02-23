import type { ReactNode } from "react"

interface InspectorGroupProps {
  label?: string
  footer?: string
  children: ReactNode
}

export function InspectorGroup({ label, footer, children }: InspectorGroupProps) {
  return (
    <div className="space-y-[7px]">
      {label && (
        <p className="text-[11px] font-semibold text-white/35 uppercase tracking-[0.08em] px-[14px]">
          {label}
        </p>
      )}
      <div className="rounded-[12px] bg-white/[0.07] overflow-hidden [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-white/[0.06]">
        {children}
      </div>
      {footer && (
        <p className="text-[11px] text-white/30 px-[14px] leading-relaxed">{footer}</p>
      )}
    </div>
  )
}

interface InspectorRowProps {
  label: string
  children?: ReactNode
  className?: string
}

export function InspectorRow({ label, children, className }: InspectorRowProps) {
  return (
    <div className={`flex items-center justify-between min-h-[44px] px-4 gap-3 ${className ?? ""}`}>
      <span className="text-[11px] text-white/40 leading-none">{label}</span>
      {children}
    </div>
  )
}

interface InspectorSliderRowProps {
  label: string
  value: string
  children: ReactNode
}

export function InspectorSliderRow({ label, value, children }: InspectorSliderRowProps) {
  return (
    <div className="px-4 pt-3 pb-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-white/40 leading-none">{label}</span>
        <span className="text-[11px] text-white/40 tabular-nums leading-none">{value}</span>
      </div>
      {children}
    </div>
  )
}
