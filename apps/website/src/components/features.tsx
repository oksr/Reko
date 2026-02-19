import { motion, useReducedMotion } from "motion/react"
import {
  Monitor,
  Mic,
  Camera,
  Film,
  ZoomIn,
  Zap,
  MousePointerClick,
  ArrowRightLeft,
} from "lucide-react"
import { Section } from "@/components/layout/section"
import { cn } from "@/lib/utils"

const FEATURES = [
  {
    icon: Monitor,
    title: "Screen Recording",
    description:
      "Capture your entire screen, a single window, or a custom area with pixel-perfect fidelity via ScreenCaptureKit.",
    span: "md:col-span-2",
  },
  {
    icon: Film,
    title: "Timeline Editor",
    description:
      "A Premiere-style NLE with multi-track clips, trimming, splitting, and precise frame-level control.",
    span: "md:col-span-1",
  },
  {
    icon: Mic,
    title: "Audio Capture",
    description:
      "Record microphone and system audio simultaneously with independent volume control.",
    span: "md:col-span-1",
  },
  {
    icon: ZoomIn,
    title: "Zoom Keyframes",
    description:
      "Add smooth zoom and pan effects to highlight key moments. Keyframes are scoped per-clip for granular control.",
    span: "md:col-span-1",
  },
  {
    icon: Camera,
    title: "Camera Overlay",
    description:
      "Embed your webcam as a picture-in-picture overlay. Resize and reposition freely.",
    span: "md:col-span-1",
  },
  {
    icon: MousePointerClick,
    title: "Cursor Effects",
    description:
      "Automatic mouse tracking with click highlights and smooth cursor animations.",
    span: "md:col-span-1",
  },
  {
    icon: ArrowRightLeft,
    title: "Transitions",
    description:
      "Built-in transition effects between clips for polished, professional cuts.",
    span: "md:col-span-1",
  },
  {
    icon: Zap,
    title: "Native Performance",
    description:
      "Built with Swift and Metal for blazing-fast rendering. Hardware-accelerated export on Apple Silicon.",
    span: "md:col-span-2",
  },
]

export function Features() {
  const prefersReducedMotion = useReducedMotion()

  return (
    <Section id="features">
      <div className="text-center mb-16">
        <motion.p
          {...(prefersReducedMotion
            ? {}
            : {
                initial: { opacity: 0, y: 12 },
                whileInView: { opacity: 1, y: 0 },
                viewport: { once: true },
                transition: { duration: 0.4, ease: [0.23, 1, 0.32, 1] },
              })}
          className="text-sm font-medium text-destructive tracking-wide uppercase mb-3"
        >
          Features
        </motion.p>
        <motion.h2
          {...(prefersReducedMotion
            ? {}
            : {
                initial: { opacity: 0, y: 14 },
                whileInView: { opacity: 1, y: 0 },
                viewport: { once: true },
                transition: { duration: 0.4, delay: 0.05, ease: [0.23, 1, 0.32, 1] },
              })}
          className="text-3xl md:text-4xl font-bold tracking-tight"
        >
          Everything you need
        </motion.h2>
        <motion.p
          {...(prefersReducedMotion
            ? {}
            : {
                initial: { opacity: 0, y: 12 },
                whileInView: { opacity: 1, y: 0 },
                viewport: { once: true },
                transition: { duration: 0.4, delay: 0.1, ease: [0.23, 1, 0.32, 1] },
              })}
          className="mt-4 text-muted-foreground text-lg max-w-xl mx-auto"
        >
          From recording to final export, Reko handles every step with native macOS performance.
        </motion.p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {FEATURES.map((feature, i) => (
          <motion.div
            key={feature.title}
            {...(prefersReducedMotion
              ? {}
              : {
                  initial: { opacity: 0, y: 16 },
                  whileInView: { opacity: 1, y: 0 },
                  viewport: { once: true },
                  transition: {
                    duration: 0.4,
                    delay: i * 0.05,
                    ease: [0.23, 1, 0.32, 1] as const,
                  },
                })}
            className={cn(
              "group relative rounded-xl border border-border bg-card/50 p-6 transition-colors hover:bg-card/80",
              feature.span
            )}
          >
            {/* Hover glow */}
            <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-[radial-gradient(ellipse_at_50%_0%,_rgba(239,68,68,0.04)_0%,_transparent_60%)]" />

            <div className="relative">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-muted/50 mb-4">
                <feature.icon size={20} className="text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  )
}
