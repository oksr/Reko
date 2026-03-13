import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { PlayerPage } from "./components/player-page"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlayerPage />
  </StrictMode>
)
