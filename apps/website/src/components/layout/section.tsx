import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface SectionProps {
  id?: string
  children: ReactNode
  className?: string
}

export function Section({ id, children, className }: SectionProps) {
  return (
    <section id={id} className={cn("py-24 md:py-32 px-6", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  )
}
