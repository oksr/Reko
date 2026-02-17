import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"

import { Nav } from "@/components/layout/nav"
import { Hero } from "@/components/hero"
import { Features } from "@/components/features"
import { Demo } from "@/components/demo"
import { HowItWorks } from "@/components/how-it-works"
import { Pricing } from "@/components/pricing"
import { Testimonials } from "@/components/testimonials"
import { CTA } from "@/components/cta"
import { Footer } from "@/components/layout/footer"

function App() {
  return (
    <div className="noise-overlay">
      <Nav />
      <main>
        <Hero />
        <Features />
        <Demo />
        <HowItWorks />
        <Pricing />
        <Testimonials />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
