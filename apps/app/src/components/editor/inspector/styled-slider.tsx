import { Button } from "@/components/ui/button"

interface StyledSliderProps {
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  onReset?: () => void
  showReset?: boolean
}

export function StyledSlider({ min, max, step = 1, value, onChange, onReset, showReset }: StyledSliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 flex items-center h-5 group">
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.08]" />
        <div
          className="absolute left-0 h-[3px] rounded-full bg-violet-400/60"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full h-5 appearance-none cursor-pointer bg-transparent z-10
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-[18px]
            [&::-webkit-slider-thumb]:h-[18px]
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-violet-400
            [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(167,139,250,0.4)]
            [&::-webkit-slider-thumb]:border-0
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:duration-150
            [&::-webkit-slider-thumb]:hover:scale-110
            [&::-webkit-slider-thumb]:active:scale-95"
        />
      </div>
      {showReset && onReset && (
        <Button
          size="sm"
          variant="ghost"
          className="text-[11px] h-6 px-2 text-muted-foreground hover:text-foreground shrink-0"
          onClick={onReset}
        >
          Reset
        </Button>
      )}
    </div>
  )
}
