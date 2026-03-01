import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"

import { Nav } from "@/components/layout/nav"
import { Hero } from "@/components/hero"
import { Features } from "@/components/features"
import { HowItWorks } from "@/components/how-it-works"
import { Pricing } from "@/components/pricing"
import { Testimonials } from "@/components/testimonials"
import { CTA } from "@/components/cta"
import { Footer } from "@/components/layout/footer"
import { DownloadModalProvider } from "@/components/download-modal"

function App() {
  return (
    <DownloadModalProvider>
    <div className="noise-overlay">
      <Nav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Pricing />
        <Testimonials />
        <CTA />
      </main>
      <Footer />
    </div>
    </DownloadModalProvider>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
