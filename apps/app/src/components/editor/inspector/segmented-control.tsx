interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="flex gap-1 p-1 rounded-full bg-white/[0.07]">
      {options.map((option) => (
        <button
          key={option.value}
          className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-full transition-all duration-200 ${
            value === option.value
              ? "bg-violet-500 text-white shadow-sm"
              : "text-white/45 hover:text-white/70"
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
