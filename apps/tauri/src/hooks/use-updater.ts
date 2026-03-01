import { useState, useEffect } from "react"
import { check } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"

type Update = Awaited<ReturnType<typeof check>>

export function useUpdater() {
  const [update, setUpdate] = useState<Update>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) return
    check().then(setUpdate).catch(console.error)
  }, [])

  const install = async () => {
    if (!update) return
    setInstalling(true)
    try {
      await update.downloadAndInstall()
      await relaunch()
    } catch (err) {
      console.error("Update failed:", err)
      setInstalling(false)
    }
  }

  return { update, install, installing }
}
