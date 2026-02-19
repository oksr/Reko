import { motion, useReducedMotion } from "motion/react"
import { Section } from "@/components/layout/section"

export function Demo() {
  const prefersReducedMotion = useReducedMotion()

  const animProps = {
    ...(prefersReducedMotion
      ? {}
      : {
          initial: { opacity: 0, y: 16 } as const,
          whileInView: { opacity: 1, y: 0 } as const,
          viewport: { once: true } as const,
          transition: { duration: 0.4, ease: [0.23, 1, 0.32, 1] as const },
        }),
  }

  return (
    <Section id="demo" className="relative">
      <div className="text-center mb-16">
        <motion.p
          {...animProps}
          className="text-sm font-medium text-destructive tracking-wide uppercase mb-3"
        >
          See It In Action
        </motion.p>
        <motion.h2
          {...(prefersReducedMotion
            ? {}
            : {
                ...animProps,
                transition: { duration: 0.4, delay: 0.05, ease: [0.23, 1, 0.32, 1] as const },
              })}
          className="text-3xl md:text-4xl font-bold tracking-tight"
        >
          A professional editor, built in
        </motion.h2>
      </div>

      <motion.div
        {...(prefersReducedMotion
          ? {}
          : {
              initial: { opacity: 0, y: 24, scale: 0.98 },
              whileInView: { opacity: 1, y: 0, scale: 1 },
              viewport: { once: true },
              transition: { duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] as const },
            })}
        className="relative"
      >
        {/* Ambient glow */}
        <div
          className="absolute -inset-12 bg-[radial-gradient(ellipse_at_center,_rgba(239,68,68,0.04)_0%,_transparent_65%)] blur-xl pointer-events-none"
          aria-hidden="true"
        />

        {/* Browser frame */}
        <div className="relative rounded-2xl border border-border bg-card shadow-[0_30px_80px_rgba(0,0,0,0.5)] overflow-hidden">
          {/* Title bar */}
          <div className="flex items-center gap-2 px-4 h-10 border-b border-border bg-[oklch(0.18_0_0)]">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
              <div className="w-3 h-3 rounded-full bg-[#28c840]" />
            </div>
            <div className="flex-1 text-center">
              <span className="text-xs text-muted-foreground/60">
                Reko — Edit, preview, and export
              </span>
            </div>
            <div className="w-[52px]" />
          </div>

          {/* Content area with detailed UI mockup */}
          <div className="aspect-[16/9] bg-[oklch(0.15_0_0)] p-5 flex flex-col gap-3">
            {/* Header bar */}
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded bg-[#ef4444]/20 border border-[#ef4444]/30" />
                <div className="w-px h-5 bg-border" />
                <div className="flex gap-1.5">
                  <div className="w-14 h-6 rounded-md bg-muted/25 flex items-center justify-center">
                    <div className="w-8 h-2 rounded bg-muted-foreground/30" />
                  </div>
                  <div className="w-14 h-6 rounded-md bg-muted/15 flex items-center justify-center">
                    <div className="w-8 h-2 rounded bg-muted-foreground/20" />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-14 h-6 rounded-md bg-muted/20 flex items-center justify-center">
                  <div className="w-6 h-2 rounded bg-muted-foreground/20" />
                </div>
                <div className="w-20 h-6 rounded-md bg-foreground/90 flex items-center justify-center">
                  <div className="w-10 h-2 rounded bg-background/50" />
                </div>
              </div>
            </div>

            {/* Main editor area */}
            <div className="flex-1 flex gap-3 min-h-0">
              {/* Video preview */}
              <div className="flex-1 rounded-lg bg-black/30 border border-border/50 flex items-center justify-center overflow-hidden relative">
                {/* Mock video content */}
                <div className="w-4/5 aspect-video rounded bg-gradient-to-br from-[oklch(0.20_0.02_260)] to-[oklch(0.15_0.01_280)] relative">
                  {/* Screen content shapes */}
                  <div className="absolute inset-4 space-y-2">
                    <div className="w-1/3 h-3 rounded bg-foreground/10" />
                    <div className="w-2/3 h-2 rounded bg-foreground/5" />
                    <div className="w-1/2 h-2 rounded bg-foreground/5" />
                    <div className="mt-4 w-full h-16 rounded-lg bg-foreground/5 border border-foreground/5" />
                  </div>
                  {/* Camera overlay circle */}
                  <div className="absolute bottom-3 right-3 w-14 h-14 rounded-full bg-gradient-to-br from-[oklch(0.35_0.02_30)] to-[oklch(0.25_0.02_30)] border-2 border-foreground/10" />
                </div>

                {/* Playback controls */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-1.5 rounded-full bg-black/50 backdrop-blur-sm border border-border/30">
                  <div className="w-4 h-4 rounded-full bg-foreground/20" />
                  <div className="text-[10px] text-muted-foreground/50 font-mono">
                    0:12 / 2:34
                  </div>
                </div>
              </div>

              {/* Right inspector panel */}
              <div className="w-48 hidden lg:flex flex-col gap-3 rounded-lg bg-muted/8 border border-border/50 p-3">
                <div className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                  Properties
                </div>
                <div className="space-y-3">
                  {["Position", "Scale", "Opacity", "Rotation"].map((prop) => (
                    <div key={prop} className="space-y-1">
                      <div className="text-[9px] text-muted-foreground/40">{prop}</div>
                      <div className="h-6 rounded bg-muted/15 border border-border/50" />
                    </div>
                  ))}
                </div>
                <div className="mt-auto pt-3 border-t border-border/30">
                  <div className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
                    Zoom
                  </div>
                  <div className="h-16 rounded bg-muted/10 border border-border/50 relative overflow-hidden">
                    {/* Zoom curve visualization */}
                    <svg className="w-full h-full" viewBox="0 0 100 40">
                      <path
                        d="M0 35 Q25 35 35 15 Q45 5 55 5 Q65 5 75 20 Q85 35 100 35"
                        fill="none"
                        stroke="rgba(239,68,68,0.4)"
                        strokeWidth="1.5"
                      />
                      <circle cx="35" cy="15" r="2.5" fill="#ef4444" opacity="0.6" />
                      <circle cx="55" cy="5" r="2.5" fill="#ef4444" opacity="0.6" />
                      <circle cx="75" cy="20" r="2.5" fill="#ef4444" opacity="0.6" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="h-24 rounded-lg bg-muted/8 border border-border/50 p-2.5 flex flex-col gap-1.5">
              {/* Ruler */}
              <div className="flex items-end gap-0 h-3 px-1">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex-1 flex flex-col items-start">
                    <div className="w-px h-2 bg-muted-foreground/15" />
                  </div>
                ))}
                {/* Playhead */}
                <div className="absolute" style={{ left: "35%" }}>
                  <div className="w-0.5 h-full bg-[#ef4444]/60" />
                </div>
              </div>

              {/* Clip tracks */}
              <div className="flex-1 flex flex-col gap-1">
                <div className="flex gap-0.5 h-5">
                  <div className="w-[30%] rounded-sm bg-[oklch(0.30_0.02_260)] border border-[oklch(0.35_0.02_260)]/30" />
                  <div className="w-[2%] rounded-sm bg-muted/20" />
                  <div className="w-[25%] rounded-sm bg-[oklch(0.28_0.02_260)] border border-[oklch(0.33_0.02_260)]/30" />
                  <div className="w-[35%] rounded-sm bg-[oklch(0.26_0.02_260)] border border-[oklch(0.31_0.02_260)]/30" />
                </div>
                <div className="flex gap-0.5 h-4">
                  <div className="w-[45%] rounded-sm bg-muted/12 border border-border/30" />
                  <div className="w-[40%] rounded-sm bg-muted/12 border border-border/30" />
                </div>
                <div className="flex gap-0.5 h-3">
                  <div className="w-[60%] rounded-sm bg-[#ef4444]/8 border border-[#ef4444]/15" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </Section>
  )
}
