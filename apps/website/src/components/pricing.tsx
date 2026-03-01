import { motion, useReducedMotion } from "motion/react"
import { Check } from "lucide-react"
import { Section } from "@/components/layout/section"
import { Button } from "@/components/ui/button"
import AppleIcon from "@/components/icons/apple"
import { useDownloadModal } from "@/components/download-modal"

const FEATURES = [
  "Screen, window, and area recording",
  "Microphone & system audio",
  "Timeline editor with trimming & splitting",
  "Zoom keyframes & auto-zoom",
  "Camera overlay",
  "Cursor effects & click highlights",
  "Transitions between clips",
  "Up to 4K export at 60fps",
]

export function Pricing() {
  const { openDownloadModal } = useDownloadModal()
  const prefersReducedMotion = useReducedMotion()

  const ease = [0.23, 1, 0.32, 1] as const

  return (
    <Section id="pricing">
      <div className="text-center mb-16">
        <motion.p
          {...(prefersReducedMotion
            ? {}
            : {
                initial: { opacity: 0, y: 12 },
                whileInView: { opacity: 1, y: 0 },
                viewport: { once: true },
                transition: { duration: 0.4, ease },
              })}
          className="text-sm font-medium text-destructive tracking-wide uppercase mb-3"
        >
          Early Access
        </motion.p>
        <motion.h2
          {...(prefersReducedMotion
            ? {}
            : {
                initial: { opacity: 0, y: 14 },
                whileInView: { opacity: 1, y: 0 },
                viewport: { once: true },
                transition: { duration: 0.4, delay: 0.05, ease },
              })}
          className="text-3xl md:text-4xl font-bold tracking-tight"
        >
          Free while in early access
        </motion.h2>
        <motion.p
          {...(prefersReducedMotion
            ? {}
            : {
                initial: { opacity: 0, y: 12 },
                whileInView: { opacity: 1, y: 0 },
                viewport: { once: true },
                transition: { duration: 0.4, delay: 0.1, ease },
              })}
          className="mt-4 text-muted-foreground text-lg max-w-lg mx-auto"
        >
          Get every feature for free today. Premium features are coming later.
        </motion.p>
      </div>

      <motion.div
        {...(prefersReducedMotion
          ? {}
          : {
              initial: { opacity: 0, y: 16 },
              whileInView: { opacity: 1, y: 0 },
              viewport: { once: true },
              transition: { duration: 0.4, delay: 0.15, ease },
            })}
        className="relative rounded-xl border border-[#ef4444]/30 bg-card shadow-[0_0_40px_rgba(239,68,68,0.06)] p-8 max-w-lg mx-auto"
      >
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#ef4444] text-white text-xs font-medium">
            Free
          </span>
        </div>

        <div className="text-center mb-8">
          <span className="text-4xl font-bold">$0</span>
          <span className="text-muted-foreground ml-2 text-sm">
            during early access
          </span>
        </div>

        <ul className="space-y-3 mb-8">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-3">
              <Check size={16} className="mt-0.5 shrink-0 text-[#ef4444]" />
              <span className="text-sm text-muted-foreground">{feature}</span>
            </li>
          ))}
        </ul>

        <Button variant="primary" size="lg" className="w-full" onClick={openDownloadModal}>
          <AppleIcon size={15} />
          Download for Mac
        </Button>
      </motion.div>
    </Section>
  )
}
