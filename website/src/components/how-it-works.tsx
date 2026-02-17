import { motion, useReducedMotion } from "motion/react"
import { Circle, Film, Download } from "lucide-react"
import { Section } from "@/components/layout/section"

const STEPS = [
  {
    number: "01",
    title: "Record",
    description:
      "Capture your screen, webcam, microphone, and system audio with a single click. Choose full screen, window, or area mode.",
    icon: Circle,
    iconFill: true,
  },
  {
    number: "02",
    title: "Edit",
    description:
      "Trim, split, and arrange clips on a multi-track timeline. Add zoom keyframes, transitions, and cursor effects.",
    icon: Film,
    iconFill: false,
  },
  {
    number: "03",
    title: "Export",
    description:
      "Choose resolution, frame rate, and quality. Metal-accelerated encoding delivers your final video in seconds.",
    icon: Download,
    iconFill: false,
  },
]

export function HowItWorks() {
  const prefersReducedMotion = useReducedMotion()

  return (
    <Section id="how-it-works" className="relative">
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
          How It Works
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
          From screen to share in minutes
        </motion.h2>
      </div>

      <div className="relative grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6">
        {/* Connecting line (desktop only) */}
        <div
          className="hidden md:block absolute top-16 left-[20%] right-[20%] h-px bg-gradient-to-r from-transparent via-border to-transparent"
          aria-hidden="true"
        />

        {STEPS.map((step, i) => (
          <motion.div
            key={step.number}
            {...(prefersReducedMotion
              ? {}
              : {
                  initial: { opacity: 0, y: 16 },
                  whileInView: { opacity: 1, y: 0 },
                  viewport: { once: true },
                  transition: {
                    duration: 0.4,
                    delay: i * 0.08,
                    ease: [0.23, 1, 0.32, 1] as const,
                  },
                })}
            className="relative text-center"
          >
            {/* Step circle */}
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full border border-border bg-card mb-6 relative">
              <step.icon
                size={22}
                className={
                  step.iconFill
                    ? "text-[#ef4444] fill-[#ef4444]"
                    : "text-muted-foreground"
                }
              />
              {/* Step number badge */}
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#ef4444] text-white text-[10px] font-bold flex items-center justify-center">
                {i + 1}
              </span>
            </div>

            <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
              {step.description}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  )
}
