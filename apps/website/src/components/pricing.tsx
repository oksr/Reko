import { motion, useReducedMotion } from "motion/react"
import { Check } from "lucide-react"
import { Section } from "@/components/layout/section"
import { Button } from "@/components/ui/button"
import AppleIcon from "@/components/icons/apple"
import { useDownloadModal } from "@/components/download-modal"

const API_URL = import.meta.env.VITE_API_URL || "https://reko-api.yasodev.workers.dev"

const FREE_FEATURES = [
  "Screen, window, and area recording",
  "Timeline editor with trimming & splitting",
  "Zoom keyframes & auto-zoom",
  "All effects (cursor, camera, background)",
  "Export up to 4K at 60fps",
  "Share links (100MB, 7-day expiry)",
  "\"Made with Reko\" badge on shares",
]

const PRO_FEATURES = [
  "Everything in Free",
  "Share up to 5GB videos",
  "Links never expire",
  "Remove \"Made with Reko\" badge",
  "Comments on shared videos",
  "Full analytics (viewers, watch time, geography)",
  "Download toggle for viewers",
]

async function handleSubscribe() {
  try {
    const res = await fetch(`${API_URL}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (data.url) {
      window.location.href = data.url
    }
  } catch (err) {
    console.error("Checkout error:", err)
  }
}

export function Pricing() {
  const { openDownloadModal } = useDownloadModal()
  const prefersReducedMotion = useReducedMotion()
  const ease = [0.23, 1, 0.32, 1] as const

  const animProps = (delay: number) =>
    prefersReducedMotion
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true },
          transition: { duration: 0.4, delay, ease },
        }

  return (
    <Section id="pricing">
      <div className="text-center mb-16">
        <motion.p {...animProps(0)} className="text-sm font-medium text-destructive tracking-wide uppercase mb-3">
          Pricing
        </motion.p>
        <motion.h2 {...animProps(0.05)} className="text-3xl md:text-4xl font-bold tracking-tight">
          Free app. Pro sharing.
        </motion.h2>
        <motion.p {...animProps(0.1)} className="mt-4 text-muted-foreground text-lg max-w-xl mx-auto">
          Reko is free forever. Pay only if you want premium sharing features.
        </motion.p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        {/* Free tier */}
        <motion.div {...animProps(0.15)} className="rounded-xl border border-border bg-card p-8">
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-1">Free</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold">$0</span>
              <span className="text-muted-foreground text-sm">forever</span>
            </div>
          </div>

          <ul className="space-y-3 mb-8">
            {FREE_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{feature}</span>
              </li>
            ))}
          </ul>

          <Button variant="secondary" size="lg" className="w-full" onClick={openDownloadModal}>
            <AppleIcon size={15} />
            Download for Mac
          </Button>
        </motion.div>

        {/* Pro tier */}
        <motion.div {...animProps(0.2)} className="relative rounded-xl border border-[#ef4444]/30 bg-card shadow-[0_0_40px_rgba(239,68,68,0.06)] p-8">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#ef4444] text-white text-xs font-medium">
              Pro
            </span>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-1">Pro</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold">$8</span>
              <span className="text-muted-foreground text-sm">/month</span>
            </div>
          </div>

          <ul className="space-y-3 mb-8">
            {PRO_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-[#ef4444]" />
                <span className="text-sm text-muted-foreground">{feature}</span>
              </li>
            ))}
          </ul>

          <Button variant="primary" size="lg" className="w-full" onClick={handleSubscribe}>
            Subscribe to Pro
          </Button>
        </motion.div>
      </div>
    </Section>
  )
}
