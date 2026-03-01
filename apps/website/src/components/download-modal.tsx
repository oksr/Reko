import { useState, useCallback, createContext, useContext, type ReactNode, useEffect, useRef } from "react"
import { AnimatePresence, motion } from "motion/react"
import { X, Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import AppleIcon from "@/components/icons/apple"

const FORMSPREE_URL = "https://formspree.io/f/xwvnjbzw"
const GITHUB_RELEASE_API = "https://api.github.com/repos/oksr/Reko/releases/latest"

type DownloadModalContextType = {
  openDownloadModal: () => void
}

const DownloadModalContext = createContext<DownloadModalContextType>({
  openDownloadModal: () => {},
})

export function useDownloadModal() {
  return useContext(DownloadModalContext)
}

async function getLatestDmgUrl(): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_RELEASE_API)
    if (!res.ok) return null
    const data = await res.json()
    const dmgAsset = data.assets?.find((a: { name: string }) => a.name.endsWith(".dmg"))
    return dmgAsset?.browser_download_url ?? null
  } catch {
    return null
  }
}

function triggerDownload(url: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = ""
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export function DownloadModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const openDownloadModal = useCallback(() => {
    setOpen(true)
    setState("idle")
    setEmail("")
    setErrorMsg("")
  }, [])

  useEffect(() => {
    if (open && inputRef.current) {
      // Don't autofocus on touch devices — it opens the keyboard unexpectedly
      const isTouchDevice = "ontouchstart" in window
      if (isTouchDevice) return
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [open])

  // Close on escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || state === "submitting") return

    setState("submitting")
    setErrorMsg("")

    try {
      // Submit email to Formspree
      const res = await fetch(FORMSPREE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) throw new Error("Failed to submit")

      setState("success")

      // Fetch latest DMG and trigger download
      const dmgUrl = await getLatestDmgUrl()
      if (dmgUrl) {
        triggerDownload(dmgUrl)
      }

      // Auto-close after a delay (pauses when tab is hidden)
      const closeDelay = 3000
      let start = Date.now()
      let remaining = closeDelay
      let timeoutId = setTimeout(() => setOpen(false), remaining)

      const onVisibility = () => {
        if (document.hidden) {
          clearTimeout(timeoutId)
          remaining -= Date.now() - start
        } else {
          start = Date.now()
          timeoutId = setTimeout(() => setOpen(false), remaining)
        }
      }
      document.addEventListener("visibilitychange", onVisibility)
      // Cleanup handled by component unmount
    } catch {
      setState("error")
      setErrorMsg("Something went wrong. Please try again.")
    }
  }

  return (
    <DownloadModalContext.Provider value={{ openDownloadModal }}>
      {children}

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md px-6"
            >
              <div className="rounded-2xl border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.5)] p-8 relative">
                {/* Close button */}
                <button
                  onClick={() => setOpen(false)}
                  className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground transition-[color,background-color] duration-150 ease hover:text-foreground hover:bg-white/[0.06]"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>

                {state === "success" ? (
                  <div className="text-center py-4">
                    <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 size={24} className="text-green-400" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">Download starting...</h3>
                    <p className="text-sm text-muted-foreground">
                      Your download should begin automatically.
                      If it doesn't,{" "}
                      <button
                        onClick={async () => {
                          const url = await getLatestDmgUrl()
                          if (url) triggerDownload(url)
                        }}
                        className="text-foreground underline underline-offset-2 hover:text-white transition-[color] duration-150 ease"
                      >
                        click here
                      </button>
                      .
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="text-center mb-6">
                      <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                        <AppleIcon size={20} />
                      </div>
                      <h3 className="text-lg font-semibold mb-1">Download Reko</h3>
                      <p className="text-sm text-muted-foreground">
                        Enter your email to get the download and product updates.
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-3">
                      <input
                        ref={inputRef}
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        spellCheck={false}
                        autoComplete="email"
                        className="w-full h-11 rounded-lg border border-border bg-background px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-[#ef4444]/40 focus:border-[#ef4444]/40 transition-[box-shadow,border-color] duration-150 ease"
                      />

                      {errorMsg && (
                        <p className="text-xs text-destructive">{errorMsg}</p>
                      )}

                      <Button
                        variant="primary"
                        size="lg"
                        className="w-full"
                        type="submit"
                        disabled={state === "submitting"}
                      >
                        {state === "submitting" ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <AppleIcon size={15} />
                        )}
                        {state === "submitting" ? "Starting download..." : "Download for Mac"}
                      </Button>

                      <p className="text-[11px] text-muted-foreground/60 text-center">
                        macOS 14.0 or later &middot; Apple Silicon &middot; Free during early access
                      </p>
                    </form>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </DownloadModalContext.Provider>
  )
}
