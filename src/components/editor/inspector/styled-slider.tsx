interface StyledSliderProps {
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
}

export function StyledSlider({ min, max, step = 1, value, onChange }: StyledSliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer
        bg-muted
        [&::-webkit-slider-thumb]:appearance-none
        [&::-webkit-slider-thumb]:w-3.5
        [&::-webkit-slider-thumb]:h-3.5
        [&::-webkit-slider-thumb]:rounded-full
        [&::-webkit-slider-thumb]:bg-primary
        [&::-webkit-slider-thumb]:border-2
        [&::-webkit-slider-thumb]:border-background
        [&::-webkit-slider-thumb]:shadow-sm
        [&::-webkit-slider-thumb]:transition-transform
        [&::-webkit-slider-thumb]:hover:scale-110"
      style={{
        background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--muted)) ${pct}%)`,
      }}
    />
  )
}
