import { useState, useEffect } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { Copy, Check, ExternalLink, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"

const SHARE_API_URL = import.meta.env.VITE_SHARE_API_URL || "https://reko-api.yasodev.workers.dev"
const PRICING_URL = "https://reko.video/#pricing"

type LicenseStatus = "none" | "loading" | "active" | "canceled" | "past_due" | "error"

interface StatusInfo {
  tier: string
  status: string
  email: string | null
}

export function ProSettings() {
  const platform = usePlatform()
  const [licenseKey, setLicenseKey] = useState("")
  const [keyInput, setKeyInput] = useState("")
  const [status, setStatus] = useState<LicenseStatus>("loading")
  const [statusInfo, setStatusInfo] = useState<StatusInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem("reko-license-key")
    if (stored) {
      setLicenseKey(stored)
      validateKey(stored)
    } else {
      setStatus("none")
    }
  }, [])

  async function validateKey(key: string) {
    setStatus("loading")
    try {
      const res = await fetch(`${SHARE_API_URL}/api/billing/status?key=${encodeURIComponent(key)}`)
      if (!res.ok) throw new Error("API error")
      const data: StatusInfo = await res.json()
      setStatusInfo(data)
      setStatus(
        data.status === "active" ? "active"
        : data.status === "past_due" ? "past_due"
        : data.status === "canceled" ? "canceled"
        : "none"
      )
    } catch {
      setStatus("error")
    }
  }

  async function saveKey() {
    const key = keyInput.trim()
    if (!key) return
    localStorage.setItem("reko-license-key", key)
    setLicenseKey(key)
    setKeyInput("")
    await validateKey(key)
  }

  function removeKey() {
    localStorage.removeItem("reko-license-key")
    setLicenseKey("")
    setStatus("none")
    setStatusInfo(null)
  }

  async function copyKey() {
    if (!licenseKey) return
    await navigator.clipboard.writeText(licenseKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openUrl(url: string) {
    platform.invoke("plugin:opener|open_url", { url }).catch(() => {
      window.open(url, "_blank")
    })
  }

  const maskedKey = licenseKey ? `${licenseKey.slice(0, 8)}${"•".repeat(16)}` : ""

  return (
    <div className="space-y-5">
      {/* <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Reko Pro</h2> */}

      {/* Plan status card */}
      <div className={`relative overflow-hidden rounded-[10px] border p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_0.5px_0_rgba(255,255,255,0.04)] backdrop-blur-xl ${
        status === "active"
          ? "border-[#34c759]/20 bg-[#34c759]/[0.06]"
          : "border-white/[0.08] bg-white/[0.04]"
      }`}>
        {status === "active" && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#34c759]/[0.08] via-transparent to-transparent" />
        )}
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
              status === "active"
                ? "bg-[#34c759]/15"
                : "bg-white/[0.06]"
            }`}>
              <Sparkles size={14} className={status === "active" ? "text-[#34c759]" : "text-white/30"} />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-white">
                {status === "active" ? "Pro" : "Free"} Plan
              </div>
              {statusInfo?.email && (
                <div className="text-[11.5px] text-white/40">{statusInfo.email}</div>
              )}
            </div>
          </div>
          <StatusPill status={status} />
        </div>
      </div>

      {/* License key section */}
      {licenseKey ? (
        <div className="space-y-3">
          <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_0.5px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.05em] text-white/30">
              License Key
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-[12px] text-white/60">{maskedKey}</code>
              <button
                onClick={copyKey}
                className="rounded-[6px] p-1.5 text-white/30 transition-all duration-150 hover:bg-white/[0.08] hover:text-white/60 active:scale-95"
              >
                {copied ? <Check size={13} className="text-[#34c759]" /> : <Copy size={13} />}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            {status === "active" && (
              <button
                onClick={() => openUrl(PRICING_URL)}
                className="flex items-center gap-1.5 rounded-[8px] border border-white/[0.1] bg-white/[0.06] px-3 py-[6px] text-[12px] text-white/60 shadow-[0_0.5px_1px_rgba(0,0,0,0.15)] backdrop-blur-sm transition-all duration-150 hover:bg-white/[0.1] hover:text-white/80 active:scale-[0.98]"
              >
                Manage Subscription
                <ExternalLink size={11} />
              </button>
            )}
            {(status === "canceled" || status === "past_due") && (
              <button
                onClick={() => openUrl(PRICING_URL)}
                className="flex items-center gap-1.5 rounded-[8px] bg-[#ef4444] px-3 py-[6px] text-[12px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-all duration-150 hover:bg-[#dc2626] active:scale-[0.98]"
              >
                Resubscribe
                <ExternalLink size={11} />
              </button>
            )}
            <button
              onClick={removeKey}
              className="rounded-[8px] px-3 py-[6px] text-[12px] text-white/30 transition-all duration-150 hover:bg-white/[0.06] hover:text-red-400 active:scale-[0.98]"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Key input */}
          <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_0.5px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.05em] text-white/30">
              License Key
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveKey()}
                placeholder="rk_live_..."
                className="flex-1 rounded-[8px] border border-white/[0.1] bg-white/[0.06] px-3 py-[6px] font-mono text-[12px] text-white/80 placeholder:text-white/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] backdrop-blur-sm transition-all duration-150 focus:border-white/[0.2] focus:bg-white/[0.08] focus:outline-none"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={saveKey}
                disabled={!keyInput.trim()}
                className="h-[30px] rounded-[8px] border border-white/[0.1] bg-white/[0.08] px-3 text-[12px] font-medium text-white/80 shadow-[0_0.5px_1px_rgba(0,0,0,0.15)] hover:bg-white/[0.14] disabled:text-white/20"
              >
                Activate
              </Button>
            </div>
          </div>

          {/* Upsell */}
          <div className="relative overflow-hidden rounded-[10px] border border-[#ef4444]/15 bg-[#ef4444]/[0.04] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12)] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#ef4444]/[0.06] via-transparent to-transparent" />
            <div className="relative">
              <div className="flex items-center gap-2">
                <Sparkles size={13} className="text-[#ef4444]/70" />
                <span className="text-[13px] font-semibold text-white">Upgrade to Pro</span>
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {[
                  "Share videos up to 5GB",
                  "Links never expire",
                  "Remove \"Made with Reko\" badge",
                ].map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-[12px] text-white/45">
                    <div className="h-1 w-1 rounded-full bg-[#ef4444]/50" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => openUrl(PRICING_URL)}
                className="mt-3.5 flex items-center gap-1.5 rounded-[8px] bg-[#ef4444] px-3.5 py-[7px] text-[12px] font-medium text-white shadow-[0_1px_3px_rgba(239,68,68,0.3)] transition-all duration-150 hover:bg-[#dc2626] active:scale-[0.98]"
              >
                Get Pro — $8/mo
                <ExternalLink size={11} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: LicenseStatus }) {
  if (status === "loading") {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-[3px] text-[11px] font-medium text-white/40">
        <Loader2 size={10} className="animate-spin" />
        Checking
      </span>
    )
  }

  const config: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: "bg-[#34c759]/12", text: "text-[#34c759]", label: "Active" },
    canceled: { bg: "bg-red-500/12", text: "text-red-400", label: "Expired" },
    past_due: { bg: "bg-amber-500/12", text: "text-amber-400", label: "Past Due" },
    error: { bg: "bg-red-500/12", text: "text-red-400", label: "Error" },
    none: { bg: "bg-white/[0.06]", text: "text-white/40", label: "Free" },
  }

  const c = config[status] ?? config.none
  return (
    <span className={`rounded-full px-2.5 py-[3px] text-[11px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}
