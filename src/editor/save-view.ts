import { setCameraView, type CameraView } from './camera-edit'
import { matchSlide, singleEdit } from './slide-match'

/**
 * The text edit that saves a camera view, computed in the panel (messages
 * version 3, docs/editor-host.md). `slide` counts the slides of `shown`, the
 * text the panel shows; `current` is the file as it is now in VS Code, unsaved
 * typing included, and the edit applies to it. Only the camera values change.
 * null if the view is already there.
 */
export function viewEdit(
  shown: string,
  current: string,
  slide: number,
  view: CameraView,
): { start: number; end: number; text: string } | null | { problem: string } {
  const index = matchSlide(shown, current, slide)
  if (index < 0) {
    return {
      problem: 'that slide has been edited since the preview last updated. Save the file (Ctrl+S), then save the view again.',
    }
  }
  let next: string
  try {
    next = setCameraView(current, index, view)
  } catch (err) {
    return { problem: String((err as Error)?.message ?? err) }
  }
  return singleEdit(current, next)
}
