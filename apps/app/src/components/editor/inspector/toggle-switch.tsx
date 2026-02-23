interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

export function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[28px] w-[48px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-300 ease-in-out focus-visible:outline-none ${
        checked ? "bg-violet-500" : "bg-white/[0.14]"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-[23px] w-[23px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] ring-0 transition-transform duration-300 ease-in-out ${
          checked ? "translate-x-[22px]" : "translate-x-[2.5px]"
        }`}
      />
    </button>
  )
}
