type EditorMode = 'edit' | 'preview'

type Metrics = {
  contentWidth: number
  paddingTop: number
  paddingBottom: number
  lineHeight: number
}

type LinePatch = {
  startLine: number
  oldLineCount: number
  newLines: string[]
}

type InputPatchHint = {
  startLine: number
  oldLineCount: number
  startLinePos: number
  endLinePos: number
}

type VisibleRange = {
  startLine: number
  endLine: number
}

const SOURCE_LINE_NUMBERS_KEY = 'flymd:sourceLineNumbers:enabled'

function px(value: string | null | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(String(value || ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function getFlymd(): any {
  return window as any
}

function getEditorMode(): EditorMode {
  try {
    return (getFlymd().flymdGetMode?.() ?? 'edit') as EditorMode
  } catch {
    return 'edit'
  }
}

function isWysiwygMode(): boolean {
  try {
    return !!getFlymd().flymdGetWysiwygEnabled?.()
  } catch {
    return false
  }
}

function splitLines(text: string): string[] {
  return String(text || '').split('\n')
}

function buildLineStarts(lines: string[]): number[] {
  const starts = new Array<number>(lines.length)
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos
    pos += lines[i].length + 1
  }
  return starts
}

function rebuildLineStartsFrom(lines: string[], lineStarts: number[], startLine: number): void {
  if (!lines.length) {
    lineStarts.length = 0
    return
  }
  let pos = 0
  if (startLine > 0) {
    const prev = startLine - 1
    pos = lineStarts[prev] + lines[prev].length + 1
  }
  for (let i = startLine; i < lines.length; i++) {
    lineStarts[i] = pos
    pos += lines[i].length + 1
  }
  lineStarts.length = lines.length
}

function rebuildRowOffsetsFrom(rowHeights: number[], rowOffsets: number[], startLine: number): number {
  if (!rowHeights.length) {
    rowOffsets.length = 0
    return 0
  }
  if (startLine <= 0) {
    rowOffsets[0] = 0
    startLine = 1
  }
  for (let i = startLine; i < rowHeights.length; i++) {
    rowOffsets[i] = rowOffsets[i - 1] + rowHeights[i - 1]
  }
  rowOffsets.length = rowHeights.length
  return rowOffsets[rowHeights.length - 1] + rowHeights[rowHeights.length - 1]
}

function findLineByPos(lineStarts: number[], pos: number, textLength: number): number {
  if (!lineStarts.length) return 0
  const safePos = Math.max(0, Math.min(pos >>> 0, textLength))
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lineStarts[mid] <= safePos) lo = mid + 1
    else hi = mid - 1
  }
  return Math.max(0, Math.min(hi, lineStarts.length - 1))
}

function findLineByYOffset(rowOffsets: number[], offset: number, totalHeight: number): number {
  if (!rowOffsets.length) return 0
  const safeOffset = Math.max(0, Math.min(offset, Math.max(0, totalHeight - 1)))
  let lo = 0
  let hi = rowOffsets.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rowOffsets[mid] <= safeOffset) lo = mid + 1
    else hi = mid - 1
  }
  return Math.max(0, Math.min(hi, rowOffsets.length - 1))
}

function getSourceLineNumbersEnabled(): boolean {
  try {
    return localStorage.getItem(SOURCE_LINE_NUMBERS_KEY) !== 'false'
  } catch {
    return true
  }
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

function commonSuffixLength(a: string, b: string, prefix: number): number {
  const limit = Math.min(a.length, b.length) - prefix
  let i = 0
  while (i < limit && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++
  return i
}

function createLinePatch(
  prevText: string,
  nextText: string,
  prevLines: string[],
  prevLineStarts: number[],
): LinePatch | null {
  if (prevText === nextText) return null
  const prefix = commonPrefixLength(prevText, nextText)
  const suffix = commonSuffixLength(prevText, nextText, prefix)
  const oldChangeStart = prefix
  const oldChangeEnd = prevText.length - suffix
  const newChangeEnd = nextText.length - suffix
  const startLine = findLineByPos(prevLineStarts, oldChangeStart, prevText.length)
  const endLine = findLineByPos(prevLineStarts, Math.max(oldChangeStart, oldChangeEnd), prevText.length)
  const startLinePos = prevLineStarts[startLine] ?? 0
  const endLinePos = (prevLineStarts[endLine] ?? 0) + (prevLines[endLine]?.length ?? 0)
  const prefixFragment = prevText.slice(startLinePos, oldChangeStart)
  const suffixFragment = prevText.slice(oldChangeEnd, endLinePos)
  const replacement = prefixFragment + nextText.slice(oldChangeStart, newChangeEnd) + suffixFragment
  return {
    startLine,
    oldLineCount: Math.max(1, endLine - startLine + 1),
    newLines: splitLines(replacement),
  }
}

function createInputPatchHint(
  lines: string[],
  lineStarts: number[],
  textLength: number,
  startPos: number,
  endPos: number,
): InputPatchHint | null {
  if (!lines.length || !lineStarts.length) return null
  const safeStart = Math.max(0, Math.min(startPos >>> 0, textLength))
  const safeEnd = Math.max(safeStart, Math.min(endPos >>> 0, textLength))
  const startLine = findLineByPos(lineStarts, safeStart, textLength)
  const endLine = findLineByPos(lineStarts, safeEnd, textLength)
  return {
    startLine,
    oldLineCount: Math.max(1, endLine - startLine + 1),
    startLinePos: lineStarts[startLine] ?? 0,
    endLinePos: (lineStarts[endLine] ?? 0) + (lines[endLine]?.length ?? 0),
  }
}

function createLinePatchFromHint(prevText: string, nextText: string, hint: InputPatchHint): LinePatch | null {
  const tailLength = Math.max(0, prevText.length - hint.endLinePos)
  const nextEndLinePos = Math.max(hint.startLinePos, nextText.length - tailLength)
  if (nextEndLinePos < hint.startLinePos) return null
  return {
    startLine: hint.startLine,
    oldLineCount: hint.oldLineCount,
    newLines: splitLines(nextText.slice(hint.startLinePos, nextEndLinePos)),
  }
}

function readMetrics(editor: HTMLTextAreaElement): Metrics {
  const style = window.getComputedStyle(editor)
  const paddingLeft = px(style.paddingLeft)
  const paddingRight = px(style.paddingRight)
  let lineHeight = px(style.lineHeight)
  if (!lineHeight) {
    const fontSize = px(style.fontSize, 16)
    lineHeight = fontSize * 1.7
  }
  return {
    contentWidth: Math.max(0, editor.clientWidth - paddingLeft - paddingRight),
    paddingTop: px(style.paddingTop),
    paddingBottom: px(style.paddingBottom),
    lineHeight,
  }
}

function applyMeasureStyle(
  shell: HTMLDivElement,
  editor: HTMLTextAreaElement,
  gutter: HTMLDivElement,
  measure: HTMLDivElement,
  metrics: Metrics,
): string {
  const style = window.getComputedStyle(editor)
  const shared: Array<[string, string]> = [
    ['fontFamily', style.fontFamily],
    ['fontSize', style.fontSize],
    ['fontWeight', style.fontWeight],
    ['fontStyle', style.fontStyle],
    ['lineHeight', style.lineHeight],
    ['letterSpacing', style.letterSpacing],
    ['tabSize', (style as any).tabSize || '4'],
  ]
  for (const [key, value] of shared) {
    try {
      ;(gutter.style as any)[key] = value
      ;(measure.style as any)[key] = value
    } catch {}
  }
  shell.style.setProperty('--editor-line-height', `${metrics.lineHeight}px`)
  gutter.style.paddingTop = `${metrics.paddingTop}px`
  gutter.style.paddingBottom = `${metrics.paddingBottom}px`
  measure.style.width = `${metrics.contentWidth}px`
  return [
    editor.clientWidth,
    metrics.contentWidth,
    metrics.paddingTop,
    metrics.paddingBottom,
    metrics.lineHeight,
    style.fontFamily,
    style.fontSize,
    style.letterSpacing,
    style.fontWeight,
    style.fontStyle,
    (style as any).tabSize || '4',
  ].join('|')
}

function createRow(): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'editor-line-number'
  return row
}

function setRowGeometry(row: HTMLDivElement, top: number, height: number): void {
  row.style.top = `${top}px`
  row.style.height = `${height}px`
}

function measureLineHeight(
  probe: HTMLDivElement,
  metrics: Metrics,
  lineText: string,
): number {
  probe.textContent = lineText || '\u200b'
  return Math.max(metrics.lineHeight, probe.offsetHeight || 0)
}

function setActiveRow(
  renderedRows: HTMLDivElement[],
  renderedStartLine: number,
  renderedEndLine: number,
  lineCount: number,
  nextRow: number,
  prevRow: number,
): number {
  const maxRow = Math.max(1, lineCount || 1)
  const safeRow = Math.max(1, Math.min(nextRow, maxRow))
  if (prevRow > 0 && prevRow !== safeRow) {
    const prevIndex = prevRow - 1
    if (prevIndex >= renderedStartLine && prevIndex < renderedEndLine) {
      renderedRows[prevIndex - renderedStartLine]?.classList.remove('active')
    }
  }
  const nextIndex = safeRow - 1
  if (nextIndex >= renderedStartLine && nextIndex < renderedEndLine) {
    renderedRows[nextIndex - renderedStartLine]?.classList.add('active')
  }
  return safeRow
}

function hookEditorTextMutations(editor: HTMLTextAreaElement, onTextChanged: () => void): void {
  try {
    const valueDesc =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    if (valueDesc?.get && valueDesc?.set) {
      const readValue = () => String(valueDesc.get!.call(editor) || '')
      const writeValue = (next: string) => valueDesc.set!.call(editor, next)
      Object.defineProperty(editor, 'value', {
        configurable: true,
        enumerable: valueDesc.enumerable ?? true,
        get() {
          return readValue()
        },
        set(next: string) {
          const prev = readValue()
          writeValue(next)
          if (readValue() !== prev) onTextChanged()
        },
      })
    }
  } catch {}

  try {
    const originalSetRangeText = editor.setRangeText.bind(editor)
    ;(editor as any).setRangeText = (...args: any[]) => {
      const prev = String(editor.value || '')
      const result = originalSetRangeText(...args)
      if (String(editor.value || '') !== prev) onTextChanged()
      return result
    }
  } catch {}
}

function installLineNumbers(): void {
  try {
    const editor = document.getElementById('editor') as HTMLTextAreaElement | null
    if (!editor) return
    const flymd = getFlymd()
    if (flymd.__flymdSourceLineNumbersInit) return
    flymd.__flymdSourceLineNumbersInit = true

    const shell = document.createElement('div')
    shell.className = 'editor-shell'

    const gutter = document.createElement('div')
    gutter.className = 'editor-gutter'
    gutter.setAttribute('aria-hidden', 'true')

    const lineNumbers = document.createElement('div')
    lineNumbers.className = 'editor-line-numbers'
    gutter.appendChild(lineNumbers)

    const surface = document.createElement('div')
    surface.className = 'editor-surface'

    const measure = document.createElement('div')
    measure.className = 'editor-line-measure'
    measure.setAttribute('aria-hidden', 'true')

    const measureProbe = document.createElement('div')
    measureProbe.className = 'editor-line-measure-row'
    measure.appendChild(measureProbe)

    const parent = editor.parentElement
    if (!parent) return
    parent.insertBefore(shell, editor)
    shell.appendChild(gutter)
    shell.appendChild(surface)
    surface.appendChild(editor)
    surface.appendChild(measure)

    let lastText = String(editor.value || '')
    let lastMetricsKey = ''
    let activeRow = 0
    let lines: string[] = splitLines(lastText)
    let lineStarts: number[] = buildLineStarts(lines)
    let rowHeights: number[] = []
    let rowOffsets: number[] = []
    let totalHeight = 0
    let currentMetrics: Metrics | null = null
    let needsTextRefresh = false
    let needsLayoutRefresh = true
    let raf = 0
    let lastGutterWidth = ''
    let lastScrollTop = Number.NaN
    let renderedStartLine = -1
    let renderedEndLine = -1
    let renderedRows: HTMLDivElement[] = []
    let pendingInputPatch: InputPatchHint | null = null
    let lineNumbersPrefEnabled = getSourceLineNumbersEnabled()
    let lineNumbersActive = false

    flymd.flymdGetSourceEditorPositionInfo = (pos: number) => {
      try {
        const textLength = lastText.length >>> 0
        const safePos = Math.max(0, Math.min(pos >>> 0, textLength))
        const lineIndex = findLineByPos(lineStarts, safePos, textLength)
        const lineStart = lineStarts[lineIndex] ?? 0
        return {
          row: lineIndex + 1,
          col: Math.max(1, safePos - lineStart + 1),
          chars: textLength,
        }
      } catch {
        return null
      }
    }

    flymd.flymdGetSourceEditorLineText = (lineNumber: number) => {
      try {
        const idx = Math.max(1, Math.floor(Number(lineNumber) || 1)) - 1
        return lines[idx] ?? ''
      } catch {
        return ''
      }
    }

    flymd.flymdGetSourceEditorLinesSnapshot = () => {
      try {
        return {
          lines,
          lineStarts,
          chars: lastText.length >>> 0,
        }
      } catch {
        return null
      }
    }

    const clearRenderedRows = (resetHeight = false) => {
      if (renderedRows.length || lineNumbers.childElementCount) {
        lineNumbers.replaceChildren()
      }
      renderedRows = []
      renderedStartLine = -1
      renderedEndLine = -1
      if (resetHeight) lineNumbers.style.height = '0px'
      lineNumbers.style.counterReset = 'flymd-line 0'
    }

    const rebuildTextState = (text: string) => {
      lines = splitLines(text)
      lineStarts = buildLineStarts(lines)
      lastText = text
    }

    const resetLayoutState = (metrics: Metrics) => {
      rowHeights = new Array<number>(lines.length).fill(metrics.lineHeight)
      rowOffsets = new Array<number>(lines.length).fill(0)
      totalHeight = rebuildRowOffsetsFrom(rowHeights, rowOffsets, 0)
      clearRenderedRows(false)
    }

    const rebuildAllState = (metrics: Metrics | null, text: string) => {
      rebuildTextState(text)
      if (metrics) resetLayoutState(metrics)
      else {
        rowHeights = []
        rowOffsets = []
        totalHeight = 0
        clearRenderedRows(true)
      }
      activeRow = 0
    }

    const syncGutterWidth = () => {
      if (!lineNumbersPrefEnabled) return false
      const digits = Math.max(2, String(Math.max(1, lines.length)).length)
      const widthPx = Math.max(48, 20 + digits * 10)
      const next = `${widthPx}px`
      if (next === lastGutterWidth) return false
      lastGutterWidth = next
      shell.style.setProperty('--editor-line-gutter-width', next)
      return true
    }

    const remeasureRange = (startLine: number, count: number, metrics: Metrics) => {
      if (!rowHeights.length) return false
      const safeStart = Math.max(0, Math.min(startLine, lines.length))
      const safeEnd = Math.max(safeStart, Math.min(lines.length, safeStart + Math.max(0, count)))
      let changedFrom = -1
      for (let i = safeStart; i < safeEnd; i++) {
        const height = measureLineHeight(measureProbe, metrics, lines[i] || '')
        if (rowHeights[i] !== height) {
          rowHeights[i] = height
          if (changedFrom < 0) changedFrom = i
        }
      }
      if (changedFrom >= 0) {
        totalHeight = rebuildRowOffsetsFrom(rowHeights, rowOffsets, changedFrom)
        return true
      }
      return false
    }

    const remeasureAll = (metrics: Metrics) => {
      if (!rowHeights.length || rowHeights.length !== lines.length) {
        resetLayoutState(metrics)
      }
      const changed = remeasureRange(0, lines.length, metrics)
      if (!changed) totalHeight = rebuildRowOffsetsFrom(rowHeights, rowOffsets, 0)
    }

    const applyTextPatch = (text: string, metrics: Metrics | null, hint: InputPatchHint | null) => {
      if (text === lastText) return
      const patch = (hint ? createLinePatchFromHint(lastText, text, hint) : null)
        || createLinePatch(lastText, text, lines, lineStarts)
      if (!patch) {
        lastText = text
        return
      }

      const startLine = patch.startLine
      const oldLineCount = patch.oldLineCount
      const newLineCount = patch.newLines.length

      lines.splice(startLine, oldLineCount, ...patch.newLines)
      if (lineStarts.length) {
        lineStarts.splice(startLine, oldLineCount, ...new Array<number>(newLineCount).fill(0))
      }
      rebuildLineStartsFrom(lines, lineStarts, startLine)
      lastText = text
      activeRow = 0
      // 行数变化时才全量清空行号 DOM；同行编辑（如打字）只需就地更新几何信息
      if (oldLineCount !== newLineCount) clearRenderedRows(false)

      if (!metrics || !rowHeights.length) return

      rowHeights.splice(startLine, oldLineCount, ...new Array<number>(newLineCount).fill(metrics.lineHeight))
      totalHeight = rebuildRowOffsetsFrom(rowHeights, rowOffsets, startLine)
      // composing 期间跳过 DOM 测量（measureLineHeight 会触发回流）；compositionend 后只测量变化行
      if (!_composing || _needsRemeasureAfterComposing) {
        _needsRemeasureAfterComposing = false
        remeasureRange(startLine, newLineCount, metrics)
      }
    }

    const getVisibleRange = (metrics: Metrics): VisibleRange => {
      if (!lines.length || !rowOffsets.length) return { startLine: 0, endLine: 0 }
      const viewportHeight = Math.max(
        metrics.lineHeight * 6,
        editor.clientHeight - metrics.paddingTop - metrics.paddingBottom,
      )
      const buffer = Math.max(metrics.lineHeight * 24, viewportHeight * 0.75)
      const startOffset = Math.max(0, editor.scrollTop - buffer)
      const endOffset = editor.scrollTop + viewportHeight + buffer
      const startIndex = findLineByYOffset(rowOffsets, startOffset, totalHeight)
      const endIndex = findLineByYOffset(rowOffsets, endOffset, totalHeight)
      return {
        startLine: Math.max(0, startIndex - 1),
        endLine: Math.min(lines.length, endIndex + 2),
      }
    }

    const syncScroll = () => {
      const scrollTop = editor.scrollTop
      if (scrollTop === lastScrollTop) return false
      lastScrollTop = scrollTop
      lineNumbers.style.transform = `translateY(${-scrollTop}px)`
      return true
    }

    const renderVisibleRows = (force = false) => {
      if (!lineNumbersActive || !currentMetrics || !rowHeights.length || !rowOffsets.length || !lines.length) {
        clearRenderedRows(true)
        activeRow = 0
        return
      }

      const range = getVisibleRange(currentMetrics)
      if (range.endLine <= range.startLine) {
        clearRenderedRows(true)
        activeRow = 0
        return
      }

      lineNumbers.style.height = `${Math.max(0, totalHeight)}px`
      lineNumbers.style.counterReset = `flymd-line ${range.startLine}`

      if (force || range.startLine !== renderedStartLine || range.endLine !== renderedEndLine) {
        // 范围相同 + 已有渲染行：就地更新几何信息，避免 DOM 全量重建
        if (range.startLine === renderedStartLine && range.endLine === renderedEndLine && renderedRows.length > 0) {
          for (let i = 0; i < renderedRows.length; i++) {
            const li = renderedStartLine + i
            setRowGeometry(renderedRows[i], rowOffsets[li] ?? 0, rowHeights[li] ?? currentMetrics.lineHeight)
          }
        } else {
          const frag = document.createDocumentFragment()
          const nextRows: HTMLDivElement[] = []
          for (let i = range.startLine; i < range.endLine; i++) {
            const row = createRow()
            setRowGeometry(row, rowOffsets[i] ?? 0, rowHeights[i] ?? currentMetrics.lineHeight)
            nextRows.push(row)
            frag.appendChild(row)
          }
          renderedRows = nextRows
          renderedStartLine = range.startLine
          renderedEndLine = range.endLine
          lineNumbers.replaceChildren(frag)
        }
      }

      const nextRow = findLineByPos(lineStarts, editor.selectionStart >>> 0, lastText.length) + 1
      activeRow = setActiveRow(
        renderedRows,
        renderedStartLine,
        renderedEndLine,
        lines.length,
        nextRow,
        activeRow,
      )
    }

    const flush = () => {
      raf = 0
      if (!editor.isConnected) return

      const prefEnabled = getSourceLineNumbersEnabled()
      if (prefEnabled !== lineNumbersPrefEnabled) {
        lineNumbersPrefEnabled = prefEnabled
        needsLayoutRefresh = true
      }

      const mode = getEditorMode()
      const wysiwyg = isWysiwygMode()
      const stickyNote = document.body.classList.contains('sticky-note-mode')
      const nextLineNumbersActive = lineNumbersPrefEnabled && (mode === 'edit' || document.querySelector('.container')?.classList.contains('split-preview')) && !wysiwyg && !stickyNote
      const activeChanged = nextLineNumbersActive !== lineNumbersActive
      lineNumbersActive = nextLineNumbersActive
      shell.classList.toggle('line-numbers-disabled', !lineNumbersActive)

      // composing 期间跳过所有文本处理（全文 diff / rebuildLineStarts / rebuildRowOffsets 均 O(N)），
      // 只做 scroll 同步和 active row 高亮，compositionend 会触发 needsLayoutRefresh 做完整刷新
      if (_composing) {
        if (lineNumbersActive) {
          syncScroll()
          // 只更新 active row 高亮
          if (renderedRows.length && currentMetrics) {
            const nextRow = findLineByPos(lineStarts, editor.selectionStart >>> 0, lastText.length) + 1
            activeRow = setActiveRow(renderedRows, renderedStartLine, renderedEndLine, lines.length, nextRow, activeRow)
          }
        }
        needsTextRefresh = false
        needsLayoutRefresh = false
        return
      }

      const text = String(editor.value || '')
      const textChanged = needsTextRefresh || text !== lastText

      if (textChanged) {
        if (lineNumbersPrefEnabled) {
          if (!currentMetrics) currentMetrics = readMetrics(editor)
          applyTextPatch(text, currentMetrics, pendingInputPatch)
        } else {
          applyTextPatch(text, null, pendingInputPatch)
        }
      }
      pendingInputPatch = null

      if (lineNumbersPrefEnabled) {
        if (!currentMetrics) currentMetrics = readMetrics(editor)
        const gutterWidthChanged = syncGutterWidth()
        const layoutNeedsRefresh =
          needsLayoutRefresh
          || gutterWidthChanged
          || !lastMetricsKey
          || !rowHeights.length
          || rowHeights.length !== lines.length

        let forceRender = textChanged || activeChanged

        if (layoutNeedsRefresh && currentMetrics) {
          currentMetrics = readMetrics(editor)
          lastMetricsKey = applyMeasureStyle(shell, editor, gutter, measure, currentMetrics)
          remeasureAll(currentMetrics)
          forceRender = true
        }

        if (lineNumbersActive) {
          const scrolled = syncScroll()
          renderVisibleRows(forceRender || scrolled)
        } else {
          clearRenderedRows(true)
          activeRow = 0
          lastScrollTop = Number.NaN
        }
      } else {
        currentMetrics = null
        lastMetricsKey = ''
        lastGutterWidth = ''
        rowHeights = []
        rowOffsets = []
        totalHeight = 0
        clearRenderedRows(true)
        activeRow = 0
        lastScrollTop = Number.NaN
      }

      needsTextRefresh = false
      needsLayoutRefresh = false
    }

    const schedule = (kind: 'text' | 'layout' | 'selection' = 'selection') => {
      if (kind === 'text') needsTextRefresh = true
      if (kind === 'layout') needsLayoutRefresh = true
      if (raf) return
      raf = window.requestAnimationFrame(flush)
    }

    const scheduleExternalTextRefresh = () => {
      pendingInputPatch = null
      schedule('text')
    }

    const flushNowIfNeeded = () => {
      const liveText = String(editor.value || '')
      if (!raf && !needsLayoutRefresh && !needsTextRefresh && liveText === lastText) return
      if (raf) {
        try { window.cancelAnimationFrame(raf) } catch {}
        raf = 0
      }
      flush()
    }

    let _composing = false
    let _needsRemeasureAfterComposing = false
    editor.addEventListener('compositionstart', () => { _composing = true }, { passive: true } as any)
    editor.addEventListener('compositionend', () => {
      _composing = false
      // compositionend 后需要处理 composing 期间积累的文本变化
      // 标记需要 remeasure（在 applyTextPatch 中会对变化行做测量）
      _needsRemeasureAfterComposing = true
      needsTextRefresh = true
      pendingInputPatch = null
      schedule('text')
    }, { passive: true } as any)

    const captureInputPatchHint = () => {
      try {
        // composing 期间跳过同步 flush，避免 DOM 测量阻塞输入
        if (!_composing) flushNowIfNeeded()
        pendingInputPatch = createInputPatchHint(
          lines,
          lineStarts,
          lastText.length,
          editor.selectionStart >>> 0,
          editor.selectionEnd >>> 0,
        )
      } catch {
        pendingInputPatch = null
      }
    }

    hookEditorTextMutations(editor, () => {
      // composing 期间延迟到 compositionend 后再通知，避免 imePatch 的 ta.value = newVal 触发额外同步刷新
      if (_composing) return
      scheduleExternalTextRefresh()
    })

    editor.addEventListener('beforeinput', () => captureInputPatchHint(), { passive: true } as any)
    editor.addEventListener('input', () => schedule('text'))
    editor.addEventListener('scroll', () => schedule('selection'))
    editor.addEventListener('click', () => schedule('selection'))
    editor.addEventListener('keyup', () => schedule('selection'))
    editor.addEventListener('mouseup', () => schedule('selection'))
    editor.addEventListener('select', () => schedule('selection'))
    editor.addEventListener('focus', () => schedule('selection'))
    editor.addEventListener('cut', () => schedule('text'))
    editor.addEventListener('paste', () => schedule('text'))
    window.addEventListener('resize', () => schedule('layout'))
    window.addEventListener('flymd:mode:changed', () => schedule('layout'))
    window.addEventListener('flymd:theme:changed', () => schedule('layout'))
    window.addEventListener('flymd:localeChanged', () => schedule('layout'))
    window.addEventListener('flymd:uiZoom:changed', () => schedule('layout'))
    window.addEventListener('flymd:sourceLineNumbers:changed', () => schedule('layout'))
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === editor) schedule('selection')
    })

    try {
      const ro = new ResizeObserver(() => schedule('layout'))
      ro.observe(surface)
      ro.observe(editor)
    } catch {}

    try {
      if (!flymd.__lineNumbersPatchedOpenFile && typeof flymd.flymdOpenFile === 'function') {
        flymd.__lineNumbersPatchedOpenFile = true
        const original = flymd.flymdOpenFile
        flymd.flymdOpenFile = async (...args: any[]) => {
          const result = await original.apply(flymd, args)
          scheduleExternalTextRefresh()
          return result
        }
      }
    } catch {}

    try {
      if (!flymd.__lineNumbersPatchedNewFile && typeof flymd.flymdNewFile === 'function') {
        flymd.__lineNumbersPatchedNewFile = true
        const original = flymd.flymdNewFile
        flymd.flymdNewFile = async (...args: any[]) => {
          const result = await original.apply(flymd, args)
          scheduleExternalTextRefresh()
          return result
        }
      }
    } catch {}

    rebuildAllState(lineNumbersPrefEnabled ? readMetrics(editor) : null, lastText)
    if (lineNumbersPrefEnabled) currentMetrics = readMetrics(editor)
    schedule('layout')
  } catch {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(installLineNumbers, 800)
  })
} else {
  setTimeout(installLineNumbers, 800)
}

export {}
