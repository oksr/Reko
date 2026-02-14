import { useState, useEffect } from "react"

interface Props {
  onComplete: () => void
  onCancel: () => void
}

export function Countdown({ onComplete, onCancel }: Props) {
  const [count, setCount] = useState(3)

  useEffect(() => {
    if (count <= 0) {
      onComplete()
      return
    }

    const timer = setTimeout(() => {
      setCount((c) => c - 1)
    }, 1000)

    return () => clearTimeout(timer)
  }, [count, onComplete])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCancel])

  if (count <= 0) return null

  return (
    <div className="flex items-center justify-center" onMouseDown={(e) => e.stopPropagation()}>
      <span key={count} className="countdown-number">
        {count}
      </span>
    </div>
  )
}
