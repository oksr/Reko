import { motion, useReducedMotion } from "motion/react"
import { Apple, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Section } from "@/components/layout/section"

export function Hero() {
  const prefersReducedMotion = useReducedMotion()

  const ease = [0.25, 0.1, 0.25, 1] as const

  const animProps = (delay: number) =>
    prefersReducedMotion
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease },
        }

  return (
    <Section className="pt-36 md:pt-48 pb-16 md:pb-24 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/3 w-[800px] h-[600px] bg-[radial-gradient(ellipse_at_center,_rgba(239,68,68,0.08)_0%,_transparent_70%)] animate-glow" />
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-[radial-gradient(ellipse_at_center,_rgba(239,68,68,0.04)_0%,_transparent_70%)] blur-3xl" />
      </div>

      <div className="relative text-center">
        {/* Badge */}
        <motion.div {...animProps(0)} className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-card/50 text-sm text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-[#ef4444] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ef4444]" />
            </span>
            Now available for macOS
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1
          {...animProps(0.1)}
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-balance leading-[1.08] max-w-4xl mx-auto"
        >
          Record. Edit. Export.{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-foreground via-foreground to-muted-foreground/60">
            Beautifully.
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          {...animProps(0.2)}
          className="mt-6 md:mt-8 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed text-balance"
        >
          The screen recording app that gives you a professional editor.
          Built natively for macOS with Swift and Metal.
        </motion.p>

        {/* CTAs */}
        <motion.div
          {...animProps(0.3)}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Button size="lg">
            <Apple size={17} />
            Download for Mac
          </Button>
          <Button variant="secondary" size="lg">
            <Play size={15} fill="currentColor" />
            Watch Demo
          </Button>
        </motion.div>

        {/* Hero image placeholder — browser frame */}
        <motion.div
          {...animProps(0.5)}
          className="mt-16 md:mt-24 relative"
        >
          {/* Glow behind image */}
          <div
            className="absolute -inset-8 bg-[radial-gradient(ellipse_at_center,_rgba(239,68,68,0.06)_0%,_transparent_60%)] blur-2xl pointer-events-none"
            aria-hidden="true"
          />

          {/* Browser frame */}
          <div className="relative rounded-xl border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.5),0_1px_3px_rgba(0,0,0,0.3)] overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 h-10 border-b border-border bg-[oklch(0.18_0_0)]">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex-1 text-center">
                <span className="text-xs text-muted-foreground/60">Reko — Project Editor</span>
              </div>
              <div className="w-[52px]" />
            </div>

            {/* Screenshot area */}
            <div className="aspect-[16/9] bg-gradient-to-b from-[oklch(0.17_0_0)] to-[oklch(0.14_0_0)] flex items-center justify-center relative">
              {/* Simulated editor UI */}
              <div className="w-full h-full p-4 flex flex-col gap-3">
                {/* Top toolbar */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <div className="w-20 h-7 rounded-md bg-muted/30" />
                    <div className="w-16 h-7 rounded-md bg-muted/20" />
                    <div className="w-16 h-7 rounded-md bg-muted/20" />
                  </div>
                  <div className="flex gap-2">
                    <div className="w-24 h-7 rounded-md bg-muted/20" />
                    <div className="w-20 h-7 rounded-md bg-[#ef4444]/20 border border-[#ef4444]/30" />
                  </div>
                </div>

                {/* Main area */}
                <div className="flex-1 flex gap-3 min-h-0">
                  {/* Preview */}
                  <div className="flex-1 rounded-lg bg-muted/10 border border-border flex items-center justify-center">
                    <div className="w-2/3 aspect-video rounded-lg bg-gradient-to-br from-muted/20 to-muted/5 border border-border/50 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-foreground/10 flex items-center justify-center">
                        <Play size={20} className="text-foreground/30 ml-0.5" />
                      </div>
                    </div>
                  </div>

                  {/* Inspector */}
                  <div className="w-52 hidden md:flex flex-col gap-2 rounded-lg bg-muted/10 border border-border p-3">
                    <div className="w-16 h-3 rounded bg-muted/40" />
                    <div className="space-y-2 mt-2">
                      <div className="flex items-center justify-between">
                        <div className="w-8 h-2.5 rounded bg-muted/20" />
                        <div className="w-16 h-6 rounded bg-muted/15 border border-border" />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="w-10 h-2.5 rounded bg-muted/20" />
                        <div className="w-16 h-6 rounded bg-muted/15 border border-border" />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="w-6 h-2.5 rounded bg-muted/20" />
                        <div className="w-16 h-6 rounded bg-muted/15 border border-border" />
                      </div>
                    </div>
                    <div className="w-16 h-3 rounded bg-muted/40 mt-4" />
                    <div className="space-y-2 mt-2">
                      <div className="h-20 rounded bg-muted/10 border border-border" />
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="h-28 rounded-lg bg-muted/10 border border-border p-3 flex flex-col gap-2">
                  {/* Time ruler */}
                  <div className="flex items-center gap-6 px-1">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="text-[9px] text-muted-foreground/30 font-mono">
                        {`0:${String(i * 5).padStart(2, "0")}`}
                      </div>
                    ))}
                  </div>
                  {/* Tracks */}
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="flex gap-1 h-6">
                      <div className="w-1/3 rounded bg-[#ef4444]/15 border border-[#ef4444]/25" />
                      <div className="w-1/4 rounded bg-muted/20 border border-border" />
                      <div className="w-1/3 rounded bg-muted/20 border border-border" />
                    </div>
                    <div className="flex gap-1 h-6">
                      <div className="w-2/5 rounded bg-muted/15 border border-border" />
                      <div className="w-1/3 rounded bg-muted/15 border border-border" />
                    </div>
                    <div className="flex gap-1 h-4">
                      <div className="w-1/2 rounded bg-muted/10 border border-border" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </Section>
  )
}
