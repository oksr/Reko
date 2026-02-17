import { motion, useReducedMotion } from "motion/react"
import { Apple } from "lucide-react"
import { Section } from "@/components/layout/section"
import { Button } from "@/components/ui/button"

export function CTA() {
  const prefersReducedMotion = useReducedMotion()

  return (
    <Section className="relative">
      {/* Background glow */}
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(239,68,68,0.06)_0%,_transparent_70%)] pointer-events-none"
        aria-hidden="true"
      />

      <motion.div
        {...(prefersReducedMotion
          ? {}
          : {
              initial: { opacity: 0, y: 24 },
              whileInView: { opacity: 1, y: 0 },
              viewport: { once: true },
              transition: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] as const },
            })}
        className="relative text-center py-8"
      >
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          Ready to create?
        </h2>
        <p className="text-muted-foreground text-lg max-w-lg mx-auto mb-10">
          Download Reko for free and start recording in seconds.
          No account required.
        </p>
        <Button size="lg">
          <Apple size={17} />
          Download for Mac
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          macOS 14.0 or later &middot; Apple Silicon & Intel
        </p>
      </motion.div>
    </Section>
  )
}
