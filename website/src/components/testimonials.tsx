import { motion, useReducedMotion } from "motion/react"
import { Section } from "@/components/layout/section"

const TESTIMONIALS = [
  {
    quote:
      "Reko replaced my entire screen recording workflow. The zoom keyframes alone are worth it — my tutorials look 10x more professional.",
    name: "Sarah Chen",
    title: "Developer Educator",
    initials: "SC",
  },
  {
    quote:
      "Finally, a native macOS recorder with a real editor. No more bouncing between three apps to make a simple demo video.",
    name: "Marcus Rivera",
    title: "Product Designer",
    initials: "MR",
  },
  {
    quote:
      "The Metal-accelerated export is insane. A 10-minute 4K video exports in under 30 seconds on my M2 MacBook.",
    name: "Aiko Tanaka",
    title: "Content Creator",
    initials: "AT",
  },
  {
    quote:
      "I switched from Loom for internal demos. The timeline editor gives me just enough control without the complexity of Premiere.",
    name: "David Park",
    title: "Engineering Manager",
    initials: "DP",
  },
  {
    quote:
      "Cursor effects and camera overlay make my bug reports actually useful. My QA team loves it.",
    name: "Elena Volkov",
    title: "QA Lead",
    initials: "EV",
  },
  {
    quote:
      "Clean, fast, and stays out of the way. Exactly what a recording tool should be. The dark UI is gorgeous too.",
    name: "James Okafor",
    title: "Indie Developer",
    initials: "JO",
  },
]

export function Testimonials() {
  const prefersReducedMotion = useReducedMotion()

  return (
    <Section id="testimonials">
      <div className="text-center mb-16">
        <motion.p
          {...(prefersReducedMotion
            ? {}
            : {
                initial: { opacity: 0, y: 16 },
                whileInView: { opacity: 1, y: 0 },
                viewport: { once: true },
                transition: { duration: 0.5 },
              })}
          className="text-sm font-medium text-destructive tracking-wide uppercase mb-3"
        >
          Testimonials
        </motion.p>
        <motion.h2
          {...(prefersReducedMotion
            ? {}
            : {
                initial: { opacity: 0, y: 16 },
                whileInView: { opacity: 1, y: 0 },
                viewport: { once: true },
                transition: { duration: 0.5, delay: 0.05 },
              })}
          className="text-3xl md:text-4xl font-bold tracking-tight"
        >
          Loved by creators
        </motion.h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {TESTIMONIALS.map((testimonial, i) => (
          <motion.div
            key={testimonial.name}
            {...(prefersReducedMotion
              ? {}
              : {
                  initial: { opacity: 0, y: 20 },
                  whileInView: { opacity: 1, y: 0 },
                  viewport: { once: true },
                  transition: {
                    duration: 0.45,
                    delay: i * 0.06,
                    ease: [0.25, 0.1, 0.25, 1] as const,
                  },
                })}
            className="rounded-xl border border-border bg-card/50 p-6 flex flex-col"
          >
            <blockquote className="text-sm text-muted-foreground leading-relaxed flex-1">
              &ldquo;{testimonial.quote}&rdquo;
            </blockquote>

            <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                {testimonial.initials}
              </div>
              <div>
                <div className="text-sm font-medium">{testimonial.name}</div>
                <div className="text-xs text-muted-foreground">
                  {testimonial.title}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  )
}
