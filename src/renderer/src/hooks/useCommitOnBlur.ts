import { useEffect, useState } from 'react'

/**
 * Local-while-focused text state that commits up to a parent only on blur /
 * Enter (not per keystroke) and re-syncs when the committed `value` changes
 * externally (drag / undo / discard / reload / tab switch). The shared machinery
 * behind the editor's commit-on-blur string inputs (a string line, a message
 * body). During typing `value` is stable, so the re-sync never clobbers an
 * in-progress edit; the caller wires `setLocal` to onChange and `commit` to
 * onBlur (and Enter → blur).
 */
export function useCommitOnBlur(
  value: string,
  onCommit: (v: string) => void
): { local: string; setLocal: (v: string) => void; commit: () => void } {
  const [local, setLocal] = useState(value)
  // Re-sync only when the committed value moves (commit / discard / reload).
  useEffect(() => {
    setLocal(value)
  }, [value])
  const commit = (): void => {
    if (local !== value) onCommit(local)
  }
  return { local, setLocal, commit }
}
