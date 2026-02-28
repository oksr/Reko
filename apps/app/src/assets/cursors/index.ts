import handPointer from "./cursor.png"
import outlineArrow from "./cursor-1.png"
import thickArrow from "./cursor-2.png"
import filledArrow from "./cursor-3.png"
import roundedPointer from "./cursor-4.png"
import systemPointer from "./cursor-pointer.png"
import systemIbeam from "./cursor-ibeam.png"
import type { CursorIcon, SystemCursorType } from "@/types/editor"

export const CURSOR_ICON_ASSETS: Record<CursorIcon, string> = {
  "hand-pointer": handPointer,
  "outline-arrow": outlineArrow,
  "thick-arrow": thickArrow,
  "filled-arrow": filledArrow,
  "rounded-pointer": roundedPointer,
}

/** System cursor type → asset URL. "arrow" is null because it uses the user's selected icon style. */
export const SYSTEM_CURSOR_ASSETS: Partial<Record<SystemCursorType, string>> = {
  pointer: systemPointer,
  ibeam: systemIbeam,
}
