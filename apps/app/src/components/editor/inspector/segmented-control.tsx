interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="flex gap-0.5 p-0.5 rounded-lg bg-white/[0.05]">
      {options.map((option) => (
        <button
          key={option.value}
          className={`flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition-all duration-150 ${
            value === option.value
              ? "bg-white/[0.12] text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground/80"
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
