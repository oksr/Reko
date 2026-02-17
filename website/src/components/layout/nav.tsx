import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Menu, X } from "lucide-react"
import { LogoWithText } from "@/assets/logo"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import AppleIcon from "@/components/icons/apple"

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-[background-color,border-color,box-shadow] duration-200 ease",
        scrolled
          ? "bg-[rgba(30,30,30,0.85)] backdrop-blur-xl border-b border-[rgba(255,255,255,0.08)] border-t border-t-[rgba(255,255,255,0.03)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
          : "bg-transparent"
      )}
    >
      <nav
        className={cn(
          "mx-auto flex items-center justify-between h-16 transition-[max-width,padding] duration-200 ease",
          scrolled ? "max-w-5xl px-8" : "max-w-6xl px-6"
        )}
      >
        <LogoWithText />

        {/* Desktop links */}
        <div
          className="hidden md:flex items-center gap-1"
          onMouseLeave={() => setHoveredLink(null)}
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onMouseEnter={() => setHoveredLink(link.href)}
              className="relative px-4 py-2 text-sm transition-colors rounded-lg"
            >
              {hoveredLink === link.href && (
                <motion.span
                  layoutId="nav-hover"
                  className="absolute inset-0 rounded-lg bg-muted/30"
                  transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
                />
              )}
              <span
                className={cn(
                  "relative z-10",
                  hoveredLink === link.href
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {link.label}
              </span>
            </a>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:block">
          <Button size="default">
            <AppleIcon size={18} />
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
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="md:hidden bg-[rgba(30,30,30,0.98)] backdrop-blur-xl border-b border-[rgba(255,255,255,0.08)] overflow-hidden"
          >
            <div className="px-6 pb-6 flex flex-col gap-1">
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
                  <AppleIcon size={15} />
                  Download for Mac
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
