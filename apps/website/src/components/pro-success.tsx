import { useState, useEffect } from "react"
import { Check, Copy, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

const API_URL = import.meta.env.VITE_API_URL || "https://reko-api.yasodev.workers.dev"

export function ProSuccess() {
  const [licenseKey, setLicenseKey] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get("token")
    if (!token) {
      setError("Missing activation token. Please check your email for the link.")
      setLoading(false)
      return
    }

    async function activate() {
      // Poll until webhook processes (returns 202 while pending)
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const res = await fetch(`${API_URL}/api/billing/activate?token=${token}`)
          if (res.ok) {
            const data = await res.json()
            setLicenseKey(data.licenseKey)
            setEmail(data.email)
            setLoading(false)
            return
          }
          if (res.status === 202) {
            // Webhook hasn't processed yet — wait and retry
            await new Promise((r) => setTimeout(r, 2000))
            continue
          }
          throw new Error(`HTTP ${res.status}`)
        } catch (err) {
          if (attempt === 9) {
            setError("Failed to activate license. Please contact support.")
            setLoading(false)
          } else {
            await new Promise((r) => setTimeout(r, 2000))
          }
        }
      }
    }

    activate()
  }, [])

  const handleCopy = async () => {
    if (!licenseKey) return
    await navigator.clipboard.writeText(licenseKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        {loading && (
          <div className="text-center">
            <Loader2 size={32} className="animate-spin text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Activating your Pro license...</p>
          </div>
        )}

        {error && (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={24} className="text-destructive" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {licenseKey && (
          <div className="rounded-xl border border-border bg-card p-8">
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <Check size={24} className="text-green-400" />
              </div>
              <h2 className="text-xl font-semibold mb-1">Welcome to Pro!</h2>
              <p className="text-sm text-muted-foreground">
                Your license key is ready. Paste it in Reko to unlock Pro features.
              </p>
            </div>

            <div className="mb-6">
              <label className="text-xs text-muted-foreground block mb-2">
                License Key
              </label>
              <div className="flex items-center gap-2 bg-background rounded-lg border border-border px-4 py-3">
                <code className="flex-1 text-sm font-mono text-foreground break-all select-all">
                  {licenseKey}
                </code>
                <button
                  onClick={handleCopy}
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div className="space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Next steps:</strong></p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>Copy your license key above</li>
                <li>Open Reko → Settings (gear icon)</li>
                <li>Paste your key in the "Reko Pro" field</li>
                <li>Share videos with no limits!</li>
              </ol>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <Button variant="primary" size="lg" className="w-full" onClick={handleCopy}>
                <Copy size={16} />
                {copied ? "Copied!" : "Copy License Key"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
