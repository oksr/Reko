import { useEffect, useState } from "react"
import { Menu, X, Apple } from "lucide-react"
import { LogoWithText } from "@/assets/logo"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-[rgba(30,30,30,0.95)] backdrop-blur-xl border-b border-[rgba(255,255,255,0.08)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
          : "bg-transparent"
      )}
    >
      <nav className="mx-auto max-w-6xl flex items-center justify-between h-16 px-6">
        <LogoWithText />

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted/30"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:block">
          <Button size="default">
            <Apple size={15} />
            Download for Mac
          </Button>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[rgba(30,30,30,0.98)] backdrop-blur-xl border-b border-[rgba(255,255,255,0.08)] px-6 pb-6">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted/30"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-3 border-t border-border mt-2">
              <Button className="w-full">
                <Apple size={15} />
                Download for Mac
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
