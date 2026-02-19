import { motion, useReducedMotion } from "motion/react"
import { Check } from "lucide-react"
import { Section } from "@/components/layout/section"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import AppleIcon from "@/components/icons/apple"

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Perfect for quick recordings and simple edits.",
    featured: false,
    features: [
      "Screen, window, and area recording",
      "Microphone & system audio",
      "Basic trimming & splitting",
      "720p export",
      "Watermark on export",
    ],
    cta: "Download Free",
  },
  {
    name: "Pro",
    price: "$29",
    period: "one-time",
    description: "Unlock the full power of Reko. Pay once, own forever.",
    featured: true,
    features: [
      "Everything in Free",
      "Camera overlay",
      "Zoom keyframes & transitions",
      "Cursor effects",
      "4K export at 60fps",
      "No watermark",
      "Priority support",
    ],
    cta: "Get Pro",
  },
]

export function Pricing() {
  const prefersReducedMotion = useReducedMotion()

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
                transition: { duration: 0.4, ease: [0.23, 1, 0.32, 1] },
              })}
          className="text-sm font-medium text-destructive tracking-wide uppercase mb-3"
        >
          Pricing
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
          Simple, fair pricing
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
          className="mt-4 text-muted-foreground text-lg"
        >
          No subscriptions. No hidden fees.
        </motion.p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        {PLANS.map((plan, i) => (
          <motion.div
            key={plan.name}
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
            className={cn(
              "relative rounded-xl border p-8 flex flex-col",
              plan.featured
                ? "border-[#ef4444]/30 bg-card shadow-[0_0_40px_rgba(239,68,68,0.06)]"
                : "border-border bg-card/50"
            )}
          >
            {plan.featured && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#ef4444] text-white text-xs font-medium">
                  Most Popular
                </span>
              </div>
            )}

            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-1">{plan.name}</h3>
              <p className="text-sm text-muted-foreground">{plan.description}</p>
            </div>

            <div className="mb-8">
              <span className="text-4xl font-bold">{plan.price}</span>
              <span className="text-muted-foreground ml-2 text-sm">
                {plan.period}
              </span>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <Check
                    size={16}
                    className={cn(
                      "mt-0.5 shrink-0",
                      plan.featured ? "text-[#ef4444]" : "text-muted-foreground"
                    )}
                  />
                  <span className="text-sm text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>

            <Button
              variant={plan.featured ? "primary" : "secondary"}
              size="lg"
              className="w-full"
            >
              {plan.featured && <AppleIcon size={15} />}
              {plan.cta}
            </Button>
          </motion.div>
        ))}
      </div>
    </Section>
  )
}
