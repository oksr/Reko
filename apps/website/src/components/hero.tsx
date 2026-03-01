import { useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Section } from "@/components/layout/section"
import AppleIcon from "@/components/icons/apple"
import { useDownloadModal } from "@/components/download-modal"

function EditorMockup() {
  return (
    <div
      role="img"
      aria-label="Reko editor interface showing timeline, inspector, and preview"
      className="relative rounded-xl border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.5),0_1px_3px_rgba(0,0,0,0.3)] overflow-hidden select-none"
    >
      {/* macOS title bar */}
      <div className="flex items-center gap-2 px-4 h-10 border-b border-white/[0.06] bg-[#1a1a1a]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 text-center">
          <span className="text-xs text-white/30">Reko</span>
        </div>
        <div className="w-[52px]" />
      </div>

      {/* Editor content */}
      <div className="aspect-[16/9] bg-[#141414] flex flex-col">
        {/* Header bar */}
        <div className="h-9 md:h-10 border-b border-white/[0.06] bg-[#1a1a1a] flex items-center justify-between px-3 md:px-4 shrink-0">
          <div className="flex items-center gap-2 md:gap-3">
            <span className="text-[9px] md:text-[10px] text-white/30 truncate max-w-[60px] md:max-w-none">My Project</span>
          </div>
          {/* Playback controls */}
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="w-5 h-5 rounded bg-white/[0.06] flex items-center justify-center">
              <div className="w-0 h-0 border-l-[5px] border-l-white/40 border-y-[3px] border-y-transparent rotate-180" />
            </div>
            <div className="w-6 h-6 rounded bg-white/[0.09] flex items-center justify-center">
              <Play size={10} className="text-white/60 ml-0.5" fill="currentColor" />
            </div>
            <div className="w-5 h-5 rounded bg-white/[0.06] flex items-center justify-center">
              <div className="w-0 h-0 border-l-[5px] border-l-white/40 border-y-[3px] border-y-transparent" />
            </div>
            <span className="text-[8px] md:text-[9px] font-mono text-white/30 tabular-nums ml-1">00:12.4 / 01:47.2</span>
          </div>
          {/* Right controls */}
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="hidden md:flex items-center gap-1">
              <div className="w-5 h-5 rounded bg-white/[0.06] flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
              </div>
              <div className="w-5 h-5 rounded bg-white/[0.06] flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
              </div>
            </div>
            <div className="px-2.5 md:px-3 h-5 md:h-6 rounded-md bg-[#3b82f6] flex items-center justify-center">
              <span className="text-[8px] md:text-[9px] font-medium text-white">Export</span>
            </div>
          </div>
        </div>

        {/* Main area: inspector + preview */}
        <div className="flex-1 flex min-h-0">
          {/* Inspector sidebar - hidden on small screens */}
          <div className="hidden md:flex w-48 lg:w-56 border-r border-white/[0.06] bg-[#1a1a1a]/50">
            {/* Tab icons */}
            <div className="w-9 border-r border-white/[0.06] flex flex-col items-center pt-2 gap-0.5">
              {[
                /* Image */ <svg key="bg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/60"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>,
                /* Frame */ <svg key="fr" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" className="text-white/25"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
                /* Camera */ <svg key="cam" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/25"><path d="m22 8-6 4 6 4V8Z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
                /* Cursor */ <svg key="cur" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/25"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>,
                /* Zoom */ <svg key="zm" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/25"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>,
              ].map((icon, i) => (
                <div
                  key={i}
                  className={`w-7 h-7 rounded flex items-center justify-center ${i === 0 ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"}`}
                >
                  {icon}
                </div>
              ))}
            </div>
            {/* Panel content */}
            <div className="flex-1 p-3 space-y-3 overflow-hidden">
              <div className="text-[9px] font-medium text-white/40 uppercase tracking-wider">Background</div>
              {/* Gradient presets grid */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  "linear-gradient(135deg, #1a1a2e, #16213e)",
                  "linear-gradient(135deg, #0a192f, #112240)",
                  "linear-gradient(135deg, #2d1b4e, #1a1a2e)",
                  "linear-gradient(135deg, #1a2332, #0d1b2a)",
                  "linear-gradient(135deg, #2b1f3a, #1a1028)",
                  "linear-gradient(135deg, #1b2838, #0f1923)",
                  "linear-gradient(135deg, #2a1a1a, #1a0f0f)",
                  "linear-gradient(135deg, #1a2a1a, #0f1a0f)",
                ].map((bg, i) => (
                  <div
                    key={i}
                    className={`aspect-square rounded-md border ${i === 0 ? "border-white/30 ring-1 ring-white/20" : "border-white/[0.06]"}`}
                    style={{ background: bg }}
                  />
                ))}
              </div>
              {/* Sliders */}
              <div className="space-y-2.5 pt-1">
                <div className="text-[9px] font-medium text-white/40 uppercase tracking-wider">Settings</div>
                {["Padding", "Radius"].map((label) => (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-white/30">{label}</span>
                      <span className="text-[8px] text-white/20 font-mono">{label === "Padding" ? "12%" : "8px"}</span>
                    </div>
                    <div className="h-1 rounded-full bg-white/[0.08] relative">
                      <div className="absolute left-0 top-0 h-full rounded-full bg-white/20" style={{ width: label === "Padding" ? "40%" : "25%" }} />
                      <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white/60 border border-white/20" style={{ left: label === "Padding" ? "40%" : "25%" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Preview canvas */}
          <div className="flex-1 bg-[#141414] overflow-hidden">
            <img src="/demo.png" alt="Reko editor preview" className="w-full h-full object-contain" />
          </div>
        </div>

        {/* Timeline area */}
        <div className="border-t border-white/[0.06] bg-[#1a1a1a]/60 shrink-0">
          {/* Timeline toolbar */}
          <div className="h-6 md:h-7 border-b border-white/[0.06] flex items-center gap-1 px-2 md:px-3">
            {["Select", "Razor", "Zoom"].map((tool, i) => (
              <div
                key={tool}
                className={`px-1.5 md:px-2 h-4 md:h-5 rounded text-[7px] md:text-[8px] flex items-center gap-1 ${i === 0 ? "bg-zinc-700 text-white" : "text-zinc-500"}`}
              >
                {i === 0 && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>}
                {i === 1 && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>}
                {i === 2 && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>}
                <span className="hidden md:inline">{tool}</span>
              </div>
            ))}
          </div>

          {/* Time ruler */}
          <div className="h-4 md:h-5 border-b border-white/[0.04] flex items-end px-2 md:px-3 relative">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex-1 flex items-end">
                <div className="flex flex-col items-start">
                  <span className="text-[6px] md:text-[7px] font-mono text-white/20 mb-0.5">{`${Math.floor(i * 10 / 60)}:${String(i * 10 % 60).padStart(2, "0")}`}</span>
                  <div className="w-px h-1.5 bg-white/15" />
                </div>
              </div>
            ))}
            {/* Playhead */}
            <div className="absolute top-0 bottom-0 left-[18%] flex flex-col items-center z-10">
              <div className="w-2 h-2 bg-[#ef4444] rounded-sm rotate-45 -mt-0.5" />
              <div className="w-px flex-1 bg-[#ef4444]/60" />
            </div>
          </div>

          {/* Tracks */}
          <div className="px-2 md:px-3 py-1.5 space-y-1">
            {/* Video/clip track */}
            <div className="flex gap-px h-6 md:h-8">
              <div className="w-[35%] rounded-sm bg-gradient-to-b from-[#d4a054] to-[#c4903e] border border-[#b8843a]/40 flex items-center px-1.5 md:px-2 overflow-hidden">
                <span className="text-[7px] md:text-[8px] text-[#1a1a1a]/70 font-medium truncate">Clip 1 · 0:35</span>
              </div>
              <div className="w-[1%] flex items-center justify-center">
                <div className="w-px h-full bg-zinc-600" />
              </div>
              <div className="w-[40%] rounded-sm bg-gradient-to-b from-[#d4a054] to-[#c4903e] border border-[#b8843a]/40 flex items-center px-1.5 md:px-2 overflow-hidden">
                <span className="text-[7px] md:text-[8px] text-[#1a1a1a]/70 font-medium truncate">Clip 2 · 0:42</span>
              </div>
              <div className="w-[1%] flex items-center justify-center">
                <div className="w-px h-full bg-zinc-600" />
              </div>
              <div className="w-[23%] rounded-sm bg-gradient-to-b from-[#d4a054] to-[#c4903e] border border-[#b8843a]/40 flex items-center px-1.5 md:px-2 overflow-hidden">
                <span className="text-[7px] md:text-[8px] text-[#1a1a1a]/70 font-medium truncate">Clip 3</span>
              </div>
            </div>

            {/* Zoom keyframe track */}
            <div className="flex h-5 md:h-6 rounded-sm bg-indigo-950/20 border border-dashed border-indigo-500/10 overflow-hidden">
              <div className="w-[10%]" />
              <div className="w-[15%] bg-indigo-500/15 border-x border-indigo-400/20 flex items-center justify-center">
                <span className="text-[6px] md:text-[7px] text-indigo-300/40">2.0x</span>
              </div>
              <div className="w-[30%]" />
              <div className="w-[20%] bg-indigo-500/15 border-x border-indigo-400/20 flex items-center justify-center">
                <span className="text-[6px] md:text-[7px] text-indigo-300/40">1.5x</span>
              </div>
            </div>

            {/* Audio waveform track */}
            <div className="h-4 md:h-5 rounded-sm bg-white/[0.02] border border-white/[0.04] flex items-end px-0.5 gap-px overflow-hidden">
              {Array.from({ length: 60 }).map((_, i) => {
                const h = Math.sin(i * 0.4) * 0.3 + Math.random() * 0.5 + 0.15
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm bg-[#d9af50]/30"
                    style={{ height: `${h * 100}%` }}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Hero() {
  const prefersReducedMotion = useReducedMotion()

  const { openDownloadModal } = useDownloadModal()

  // Skip intro animation if already seen this session
  const [skipIntro] = useState(() => {
    const seen = sessionStorage.getItem("hasSeenIntro")
    if (!seen) sessionStorage.setItem("hasSeenIntro", "true")
    return !!seen
  })

  const ease = [0.23, 1, 0.32, 1] as const

  const animProps = (delay: number, y = 16) =>
    prefersReducedMotion || skipIntro
      ? {}
      : {
          initial: { opacity: 0, y },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay, ease },
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
        <motion.div {...animProps(0, 12)} className="flex justify-center mb-8">
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
          {...animProps(0.05, 20)}
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-balance leading-[1.08] max-w-4xl mx-auto"
        >
          Record. Edit. Export.{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-foreground via-foreground to-muted-foreground/60">
            Beautifully.
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          {...animProps(0.1, 14)}
          className="mt-6 md:mt-8 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed text-balance"
        >
          Screen recording and video editing in one app.
          Built for macOS with a professional timeline editor.
        </motion.p>

        {/* CTAs */}
        <motion.div
          {...animProps(0.15, 16)}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Button size="lg" onClick={openDownloadModal}>
            <AppleIcon size={17} />
            Download for Mac
          </Button>
          <Button variant="secondary" size="lg">
            <Play size={15} fill="currentColor" />
            Watch Demo
          </Button>
        </motion.div>

        {/* Editor mockup */}
        <motion.div
          {...animProps(0.25, 24)}
          className="mt-16 md:mt-24 relative"
        >
          {/* Glow behind mockup */}
          <div
            className="absolute -inset-8 bg-[radial-gradient(ellipse_at_center,_rgba(239,68,68,0.06)_0%,_transparent_60%)] blur-2xl pointer-events-none"
            aria-hidden="true"
          />

          <EditorMockup />
        </motion.div>
      </div>
    </Section>
  )
}
