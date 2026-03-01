import { LogoWithText } from "@/assets/logo"

const FOOTER_LINKS = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "Pricing", href: "#pricing" },
  ],
}

export function Footer() {
  return (
    <footer className="border-t border-border px-6">
      <div className="mx-auto max-w-6xl py-16 md:py-20">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-10">
          {/* Brand */}
          <div className="max-w-xs">
            <LogoWithText />
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Professional screen recording and video editing,
              built natively for macOS.
            </p>
          </div>

          {/* Links */}
          {Object.entries(FOOTER_LINKS).map(([title, links]) => (
            <div key={title}>
              <h4 className="text-sm font-medium mb-4">{title}</h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-[color] duration-150 ease"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-16 pt-8 border-t border-border flex items-center justify-center">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Reko. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
