# Roadmap

[简体中文](ROADMAP.md) | [English](ROADMAP.en.md)

## Update v1.4.4
- Added: Theme Settings now includes a “Default outline tab” toggle; when enabled, the left library panel opens the Outline tab by default instead of the Files tab
- Added: Theme Settings now includes a “Disable update checks” toggle; when enabled, both startup background checks and the manual update button stop checking for new versions
- Fixed: PDF export and printing now use consistent list indentation and marker spacing, preventing unordered-list bullets from taking over the following content area
- Fixed: Bold boundary compatibility in WYSIWYG and Reading modes, making bold text wrapped by Chinese punctuation, quotes, and brackets render more reliably

## Update v1.4.3
- Fixed: When a temporary library is active, every WebDAV sync entry now skips at the sync-core layer, including startup sync, F5, the settings test button, and menu sync, preventing sync from still targeting the previous saved library
- Fixed: When the WebDAV provider is under maintenance, the network is unavailable, or remote directory scanning fails, the sync run now skips immediately instead of treating the failure as an empty remote directory, avoiding accidental local deletion or remote-delete prompts
- Fixed: When launching FastNote by double-clicking or using “Open with” on a document outside saved libraries, the temporary-library session is established before startup sync is initialized, removing a startup race that could trigger sync against the wrong library
- Improved: WebDAV sync now has a session-level blocking hook so special library states can be rejected at the single sync entry point instead of relying on UI-only disabled buttons

## Update v1.4.2
- Added: “Source + Reading split view” can now be enabled directly from Reading mode; FastNote automatically switches back to Source mode and opens the split view, reducing friction when editing while reading
- Fixed: Network proxy settings no longer globally rewrite `window.fetch`; plugin HTTP requests and update checks now have timeouts plus localhost bypasses, preventing severe slowdown after enabling a proxy
- Fixed: Dragged folders or abnormal directories are no longer treated as Markdown documents, and high-risk folders such as `EBWebView`, `node_modules`, and `.git` are skipped to avoid sidebar scan issues and stalls
- Fixed: In dark mode, the current Markdown document icon and selected state in the library sidebar now have clearer contrast
- Improved: Library sidebar scanning is more conservative around build caches, version-control folders, and WebView data directories, reducing the risk of accidentally scanning temporary/cache trees

## Update v1.4.1
- Added: When opening `md` / `markdown` / `txt` files outside the saved library through system double-click or “Open with”, FastNote now treats the file's folder as a session-only temporary library in the sidebar; it is not written to the library configuration and disappears after switching back to a saved library or closing the app
- Improved: The temporary library sidebar shows built-in supported files in the same folder (`md` / `markdown` / `txt` / `pdf`) plus plugin-provided suffixes, and marks the title as temporary to avoid confusing it with saved libraries
- Improved: WebDAV sync actions are disabled while a temporary library is active, preventing sync from targeting the previous saved library while the sidebar is showing a temporary folder
- Added: Theme Settings now includes a symbol auto-completion toggle, so paired-symbol completion can be disabled when needed
- Fixed: WYSIWYG code-block highlighting now refreshes correctly after pasting code, avoiding stale or missing rendered highlights
- Improved: Markdown / PDF icons and selected-state contrast in the library sidebar have been refined so the current file is easier to identify
- Docs: Removed the stale PackyCode relay-service link from README

## Update v1.4.0
- Fixed: App exit now checks unsaved changes across all open tabs instead of only the current document; “Save and exit” saves each dirty tab in turn to reduce the risk of losing edits in multi-tab sessions
- Fixed: In WYSIWYG mode, paragraphs containing `\$`, Excel formulas, or other `$` content are no longer rewritten incorrectly by automatic Markdown inline sync, preventing lost backslashes and corrupted Markdown markers such as bold delimiters
- Improved: Source-mode textarea undo/redo is now always handled by the per-tab custom undo stack, with tighter grouping for continuous typing/deletion, avoiding fallback to the browser's native undo history and the stale-history bugs that come with it
- Changed: The ASR Notes feature is temporarily offline by hiding only its Plugins menu entry; the underlying implementation remains in place for a later restore

## Update v1.3.9
- Added: Pasting remote images from web rich text or Markdown can now download them into the current document's `images/` folder and rewrite links to relative paths, reducing broken hotlinks and offline failures
- Improved: Source mode and WYSIWYG now share the same image-localization path, with a Theme Settings toggle to control remote-image localization

## Update v1.3.8
- Fixed: Table-of-contents anchor jumps in article Preview now land on the matching heading reliably, avoiding no-op clicks or inaccurate scroll positions
- Improved: Source mode long-document performance has been tightened again, reducing repeated work during scrolling, selection changes, line-number refreshes, and IME patch fallback paths on very large files

## Update v1.3.7
- Improved: Long-document performance in Source mode has been tightened again. High-frequency paths such as status-bar row/column calculation, title refresh, and source-outline scanning now reuse cached data, making typing and UI updates steadier on large files
- Improved: Source line numbers now measure and render incrementally for the visible range instead of rebuilding the full gutter on every scroll, click, or selection change, which is much friendlier to very large documents
- Added: Theme Settings now includes a `Source line numbers` toggle, so users can turn the gutter off when they want the lightest possible editing path
- Improved: The IME fallback path now avoids full-document diff scans in normal cases, so paired completion stays more responsive in long-text Chinese input scenarios

## Update v1.3.6
- Fixed: Local document links in Preview now resolve and open relative targets correctly, covering `md` / `markdown` / `txt` / `pdf` files as well as `file://`, drive-letter, and UNC path cases
- Fixed: Source mode Tab / Shift+Tab indentation behavior has been unified across caret, single-line selection, and multi-line selection, with compatibility for legacy indent tokens and raw tab characters
- Fixed: Maximize/restore button state now follows the real window state, making the titlebar controls more reliable in both the main window and Focus mode

## Update v1.3.5
- Improved: Startup has been slimmed down again. The main window now appears after the first frame is ready, while non-critical modules such as tabs, split view, line numbers, library resize, and the theme panel are deferred for a faster, steadier launch
- Fixed: In Source mode, `*` and backtick completion is now handled immediately, removing input lag; single/double/triple backtick wrapping and fenced-code generation respond more directly
- Improved: Tab indentation now uses a unified four-space-style indent with compatibility for older `&emsp;` / full-width-space indentation, so WYSIWYG no longer shows transcoded indent artifacts
- Improved: Source mode line numbers are toned down visually, while the active line indicator is clearer
- Updated: The extension ecosystem adds the third-party “Translate Selection” plugin; “Blinko Integration” is upgraded to v1.2.0 with article sending, note pulling, local-folder sync, and generated login portal documents

## Update v1.3.4
- Added: Source mode now shows a left-side line-number gutter that stays in sync with scrolling and highlights the current line
- Improved: Windows installers now use a dedicated icon for associated documents instead of reusing the app icon
- Improved: Windows file associations now use FastNote-owned ProgIDs such as `flymd.markdown` / `flymd.pdf`, avoiding collisions with generic system type names
- Docs: README now credits the file icon designer

## Update v1.3.3
- Fixed: Sticky Note auto-resize could jitter under multi-monitor/mixed display scaling, and the button area could cover content when the note grows
- Improved: Sticky Note height measurement waits one frame to reduce layout jitter on some devices
- Fixed: Adding a library could do nothing in some cases (path picker values now normalize `file://` / UNC paths)
- Fixed: In WYSIWYG code-block highlight layer, comments/quotes no longer use italic to avoid selection misalignment on Windows (Refs #81)
- Fixed: #80 F2 rename now reuses the dialog and supports closing with Esc
- Updated: Built-in “AI Novel Engine” v0.7.0 — “Strictly follow chapter outline” mode; world/chapter outline supports folders; one-click start flow adds “Generate Chapter 1”

## Update v1.3.2
- Fixed: WebDAV sync could fail to run before app exit
- Fixed: Window size persistence issues in zoom mode
- Fixed: Sticky Note window restore could be misaligned/distorted under Windows display scaling
- Improved: In Sticky Note mode, height resizing is disabled when the preview is hidden to avoid layout glitches
- Improved: Built-in “AI Novel Engine” settings now shows a “New users get 500k free characters” hint

## Update v1.3.1
- Added: Network proxy settings (HTTP/HTTPS) in Theme Settings; when enabled, plugin requests also route through the proxy on desktop and can bypass some CORS limitations
- Added: In Source mode, pressing Enter on ordered/unordered lists auto-continues the list marker; ordered list numbers increment; Enter on an empty item exits the list
- Updated: Built-in “flymd-RAG Knowledge Index” v0.1.6 — Office docs (Word/Excel: docx/xlsx/xls) can be converted to Markdown and indexed for semantic search

## Update v1.3.0
- Added: AI Assistant quick action “Summary” (summarizes the current document by default when there is no selection)
- Improved: Editor “scroll past end” bottom whitespace + auto stick-to-bottom when typing near the end
- Fixed: Nested context menus (3rd-level submenus) no longer get clipped by scrollable submenus (Todo menu compatibility)
- Updated: Built-in “Document Mindmap (Markmap)” v0.2.1 — text wrapping for long nodes; “AI Outline / Original” toggle (mindmap-only, does not modify the document); export SVG/PNG keeps wrapping
- Updated: Built-in “xxtui Todo Push” v0.2.2 — push title/content templates (`$title`/`$content`); plain-text push; force push toggle with “keep tail flags” option

## Update v1.2.9
- Added: Built-in “Document Mindmap (Markmap)” v0.2.0 — render the current Markdown doc as a mindmap (right dock panel, fullscreen overlay, export SVG/PNG, click node to jump)
- Added: Library tree context menu “Show in File Manager” (file opens its parent folder; folder opens itself)
- Improved: When there are too many tabs, tab widths are auto-compressed so newly opened tabs are always visible (Obsidian-style)
- Improved: Document Mindmap panel supports drag-to-resize width and remembers the panel width

## Update v1.2.8
- Added: Drag-to-resize width for the Library sidebar

## Update v1.2.7
- Improved: Moved library add/remove/rename into “Library Settings”; removal only detaches it from the list and won’t delete files on disk
- Fixed: Window operations like double-click maximize / pull-down restore
- Improved: Create document/folder/rename dialogs no longer close when clicking the overlay, preventing accidental close while selecting text

## Update v1.2.6
- Fixed: On Windows, transparent windows could occasionally show a top “white bar/ghosting” after dragging / focus changes / display-scale changes (also covers Sticky Note window)
- Improved: Sticky Note mode now autosaves on every change (debounced + serialized writes); forces a flush on blur and before switching back to preview, reducing the chance of losing edits
- Improved: Sticky Note mode hides bottom-right notifications/width bubble to reduce distractions; Sticky Note tooltips now wrap to avoid overflow
- Updated: Built-in “PDF & Image High-Precision Parsing (pdf2doc)” v0.2.8 (split threshold raised to 500 pages; refined split guidance and default auto-merge behavior)

## Update v1.2.5
- Added: PDF export progress overlay (stages/progress/elapsed/logs) with one-click cancel
- Fixed: Occasional blank/black pages when exporting very long documents (paged rendering avoids a giant canvas)
- Added: WYSIWYG table context menu actions to delete row/column
- Improved: Multi-library switcher can be shown in Ribbon or Sidebar; simplified visibility logic; refined Library Settings styling/copy
- Improved: Library tree refresh avoids blank-frame flicker (keeps the previous tree until the new one is ready)
- Improved: PDF.js lazy-load caching + worker fallback, making plugin page-count reads more reliable
- Fixed: In reading mode, `Ctrl+A` could select the library name
- Updated: Built-in “PDF & Image High-Precision Parsing (pdf2doc)” v0.2.7 (relative paths by default; better filename guessing; PDF.js worker compatibility)
- Updated: Built-in “AI Novel Engine” v0.6.9 (global hard constraints doc, auto-injected)

## Update v1.2.4
- Added: Option to insert local images using relative paths (e.g. `images/xxx.png`) for better cross-device sync (toggle in Image Host settings)
- Added: Improved local image save path strategy: prefer `images/` next to the current document; for unsaved docs use the default paste directory (fallback to the user Pictures directory)
- Added: Library settings dialog: sidebar visibility toggle, custom ordering, and per-library WebDAV toggle + remote root path
- Improved: Library sidebar vault list supports showing multiple libraries for quick switching, with styling tweaks
- Improved: WebDAV default remote root is now derived from the current library name/path (keeps legacy `/flymd` behavior for existing configured setups)
- Updated: Built-in “Image Gallery” v0.1.8 (time-based sorting)
- Updated: Built-in “AI Assistant” v0.4.6 (styling tweaks)
- Updated: Built-in “AI Novel Engine” v0.6.8
- Fixed: Menubar issues on Linux; on Windows, hide the menubar on startup while keeping accelerators

## Update v1.2.3
- Added: Built-in WebDAV sync log viewer (highlights the latest sync session; one-click clear; configurable retention days with auto-pruning)
- Improved: Built-in “Git History” v0.1.4 (Ribbon shortcut; reduced Windows console flicker when spawning `git` via `CREATE_NO_WINDOW`)
- Updated: Built-in “High-Accuracy PDF & Image Parsing (pdf2doc)” v0.2.6 (menu cleanup; optional auto-merge for split results after batch parsing; retry page-count fetch)
- Updated: Built-in “Image Gallery” v0.1.7 (Ribbon shortcut)
- Updated: Built-in “Journals & Tasks” v0.1.1 (Ribbon shortcut to open tasks & calendar panel)
- Updated: Built-in “Markdown Table Helper” v0.1.6 (removed startup “activated” toast)
- Improved: Plugin Menu Manager UI styling (clearer layout)

## Update v1.2.2
- Added: Plugin Ribbon (vertical toolbar) supports plugin buttons; Plugin Menu Manager now supports Ribbon visibility / position (Top/Bottom) / reorder
- Added: Plugin APIs `context.addRibbonButton` / `context.showDropdownMenu`, plus plugin dev docs in `plugin.md`
- Updated: Built-in “High-Accuracy PDF & Image Parsing (pdf2doc)” v0.2.4 (large-file split parsing + manual merge; resume; parse selected range; post-processing image progress, etc.)
- Updated: AI Assistant plugin v0.4.5 (Ribbon toggle button)
- Fixed/Compatibility: Improved macOS 12 compatibility (build target set to ES2020 to avoid blank window); fixed macOS/Linux standalone window config

## Update v1.2.1
- Added: Built-in “High-Accuracy PDF & Image Parsing (pdf2doc)” plugin — parse PDF/images into Markdown/Docx with translation (handwriting/layout/formulas/tables supported)
- Improved: Reading mode KaTeX rendering now uses time-slicing/idle rendering to avoid UI freezes on formula-heavy documents
- Improved: WYSIWYG KaTeX rendering now renders near-viewport math only, with small-formula caching for better performance on large documents
- Fixed: In reading mode, when the Outline is detached to the right, the preview scrollbar could be covered and become invisible

## Update v1.2.0
- Added: In PDF preview, `Ctrl+Shift+P` opens Command Palette (desktop native shortcut capture + forward)
- Improved: Library sidebar items show full filename/path on hover (including extension), avoiding ellipsis ambiguity
- Updated: PDF2Doc plugin v0.1.8 (multi-token config & rotation; total remaining pages + balance entry; pre-parse quota risk warning; large-text parsing grouped by speaker; copy tweaks)
- Improved: New plugin API `getPdfPageCount` (for PDF page-count estimation and quota prompts)

## Update v1.1.9
- Added: WebDAV encryption salt now syncs to a remote file; new devices automatically align the salt, preventing cross-device decryption failures
- Improved: WebDAV sync conflict resolution now offers an "Apply to all files" option
- Improved: After cross-device sync, local image paths are automatically remapped to "current document's images/", making images visible on new devices (without modifying document content)

## Update v1.1.8
- Added: Online announcements (fetches announcement JSON in background; shows bottom-right notifications with link action)
- Added: Reading mode context menu “Copy as rich text (embed images)” to copy images as content instead of markup
- Improved: Reduced flicker when entering WYSIWYG mode by hiding the intermediate first-frame render
- Updated: editor-enhancer v0.1.3 (Slash/Wrap command updates; Diary/Meeting templates added)
- Updated: AI Novel Engine v0.6.6 (improved index backup/restore)
- Updated: Image Gallery v0.1.6 (improved ImgLa/Lsky compatibility and paging/load-more; custom baseUrl supported)
- Updated: Typecho Post Manager v0.1.5 (added image-host migration)

## Update v1.1.7
- Added: Toggle to auto-fetch page title when pasting URLs (use `Ctrl+Shift+V` to temporarily bypass)
- Added: ASP (Additional Suffix Plugin) API — plugins can register custom file suffix rules (type/icon/open behavior)
- Added: “Suffix Extension” plugin now available in Extension Market (built on ASP)
- Added: Plugin command `list_dir_any` (list any directory) — used to infer latest backups when `latest.json` is missing
- Improved: macOS/Linux compact titlebar is enabled by default; the toggle is hidden
- Improved: Built-in/market plugins mobile adaptations and compatibility fixes (Typecho Manager Android safe-area; Image Gallery mobile; AI Assistant HTTP request compatibility; editor-enhancer “Wrap with…” and template variables)

## Update v1.1.6
- Added: “editor-enhancer” plugin with a `/` command menu, now available in Extension Market
- Fixed: Page breaks when saving as PDF (less chance of cutting lines in half)
- Improved: Faster PDF export
- Improved: WebDAV sync now supports ports other than 443
- Fixed: On Windows, dragging down a maximized window to restore could be hijacked by custom resize handles
- Changed: ImgLa uploader now shows a promo/coupon note

## Update v1.1.5
- Fixed: Incorrect table insertion position in WYSIWYG mode
- Fixed: Built-in “Image Gallery” plugin couldn’t delete images on Lsky (Lsky Pro+)
- Improved: Lsky (Lsky Pro+) storage location is now a dropdown selection
- Improved: Fallback to local on upload failure (instead of base64)

## Update v1.1.4
- Added: Shortcut `Ctrl+Shift+Z` to toggle the Library sidebar
- Improved: About dialog now includes a clearer keyboard shortcuts list
- Improved: Smaller Library sidebar trigger hotspot in split view to reduce accidental activation
- Changed: Updated icons for menu, extension marketplace, and language selector

## Update v1.1.3
- Added: Lsky (Lsky Pro+) image host support (ImgLa compatible, configurable base URL)
- Fixed: HTML sanitization on paste could break code formatting
- Changed: Built-in “Image Host Manager” copy update; refined provider labels (S3/R2, Lsky/ImgLa)
- Fixed: Built-in “Image Gallery” plugin upgraded to v0.1.4 — fixed image preview issues; paginated S3/R2 local history (9 per page)

## Update v1.1.2
- Added: Built-in image host: ImgLa uploader
- Improved: Image upload flow and config storage (manual upload / S3 / ImgLa)
- Improved: Outline auto hide/expand; refined outline layout copy and icons, plus a menu title hint
- Improved: Built-in “Image Gallery” plugin: preview support; works with built-in image hosts (including ImgLa)

## Update v1.1.1
- Improved: Tuned Windows rounded corners/shadows/transparent padding for clearer borders
- Improved: Updated window control buttons to Win10/11-style SVG icons, with clearer maximize/restore state switching
- Fixed: Window control buttons could become invisible when tabs were squeezed
- Changed: Updated refresh/update icon and theme button icon styling

## Update v1.0.4
- Added: “Update now” button in extension update notifications, one-click updates with progress display
- Improved: Preserve extension install options when updating (e.g. “Show in menu bar”) to avoid behavior changes after update
- Improved: Rounded-corner window shadow for clearer borders; compact titlebar is now always enabled and the toggle is hidden
- Improved: Built-in “flymd-RAG” plugin upgraded to v0.1.4 — plugin menu now opens Knowledge base settings directly
- Fixed: Built-in “AI Novel Engine” plugin upgraded to v0.6.5 — more conservative “dead” status detection to reduce false positives
- Changed: Updated extension marketplace `index.json` description for “AI Novel Engine” (new users get 500k characters)

## Update v1.0.3
- Added: Library sidebar search upgrade — filename/path filter; `:keyword` + Enter for full-text search (fast scan + optional deep search); `::keyword` + Enter for knowledge-base semantic search (requires flymd-RAG index)
- Improved: New UI layout — unified library sidebar width/margins; adjusted content position and default width
- Improved: Built-in “AI Assistant” plugin upgraded to v0.4.1 — improved context memory and budget strategy; better output quality and formatting

## Update v1.0.2
- Fixed: PDF export could crop or miss images when using image hosting
- Improved: WYSIWYG code blocks now have a background; refined code area styling

## Update v1.0.1
- Fixed: When printing documents containing KaTeX, wait for CSS to load to prevent formula styling loss
- Added: Outline layout button
- Improved: Auto-detect whether the current document has an outline and auto show/hide the outline panel
- Improved: Highlight the icon of the active tab
- Improved: Metadata/file-tree UI tweaks; sidebar buttons switched to icon style
- Improved: Built-in “AI Novel Engine” plugin upgraded to v0.6.4: added fully-automated mode, refined the execution logic, bundled Jina embedding models, and added a quick-jump API

## Update v0.9.9
- Added: “Print” entry in the editor right-click menu
- Fixed: Print rendering issues introduced by the new UI (render via an isolated iframe to avoid blank/incomplete prints)
- Fixed: KaTeX rendering issues in Reading mode
- Fixed: Double backslashes when copying KaTeX formulas (inline/block)

## Update v0.9.8
- Added: KaTeX mhchem enabled — supports chemical macros `\ce{...}` / `\pu{...}` (consistent across Preview and WYSIWYG)
- Improved: Built-in “AI Novel Engine” plugin upgraded to v0.6.2: clearer character-state constraints (hidden/dead/pinned), more focused RAG query steering, plus stricter continuity rules and a writing checklist
- Changed: Extension manager — removed the “Standalone display” checkbox on extension cards (no longer supported in the new UI)

## Update v0.9.6
- Added: Multi-window support — drag a tab out to create a new window; drag back to reopen as a new tab
- Added: “Ghost window” UI hint while dragging to create a new window
- Improved: Tab-drag action follows the cursor icon for clearer feedback
- Improved: PDF view caching to speed up PDF loading
- Fixed: Linux drag/resize abnormal behaviors
- Fixed: Adaptive submenu expansion to prevent overflow
- Fixed: Ghost-window residue; auto-destroy the newly created window after dragging back

## Update v0.9.5
- Added: Command palette (Ctrl+Shift+P)
- Added: Global menu manager for centralized/dynamic menu updates
- Improved: Narrower vertical menu with smaller icons
- Improved: Updated folder icons in the file tree (top-level vs nested)
- Fixed: macOS compact titlebar: window drag and minimize button could stop working
- Fixed: macOS borderless window (`decorations: false`): `minimize()` could fail
- Docs: Fixed license badge display in README

## Update v0.9.3
- Fixed: Outline panel H1/H2 expand/collapse toggles work again
- Fixed: Library sidebar folder/file icons are shown again (switched to VS Code-style SVG icons)
- Improved: When switching tabs, the library sidebar auto-expands and highlights the active document to avoid stale selection
- Improved: Built-in “AI Novel Engine” plugin upgraded to v0.6.0
- Changed: About-page license text updated to GPL-3.0 (consistent with `LICENSE`)

## Update v0.9.1
- Improved: In WYSIWYG mode, ordered/unordered list items support Tab to indent (nest) and Shift+Tab to outdent
- Improved: In WYSIWYG mode, Backspace at the start of a list item outdents (or exits the list)

## Update v0.9.0
- Added: New “Speech Transcribe” under Plugins: start/stop microphone transcription, transcribe an audio file, transcription settings (official backend proxy + custom model)
- Added: New “ASR Notes” under Plugins: streaming dictation to notes, with sign-in, remaining minutes, recharge and redeem code
- Improved: Unified microphone management; Speech Transcribe and ASR Notes are mutually exclusive to prevent recording conflicts
- Improved: Added macOS microphone usage description to avoid silent permission denial on first use
- Improved: macOS icon safe-area handling so the Dock/Finder icon doesn’t look oversized

## Update v0.8.6 - v0.8.9
- Improved: Plugin text-edit APIs now integrate with the browser undo stack, so AI-generated inserts can be undone (Ctrl+Z)
- Fixed: WYSIWYG scroll container and code-block copy overlay positioning/refresh issues (buttons could be missing until the first edit)
- Improved: WYSIWYG code-block copy button now copies plain code only (no ``` fences or language markers)

## Update v0.8.5
- New: Drag a tab out of the window to open it in a new instance (only for saved tabs with no unsaved changes)
- Improved: Wider edge trigger area to re-open the library sidebar after it’s hidden
- Improved: Persist extension panel filters (Market: “Installed only”; Installed section: “Updates only”)

## Update v0.8.4
- Fixed: In Excel/Sheets formulas, absolute refs like `$A$1` / `C$2` / `$U:$U` no longer falsely trigger Markdown inline math (KaTeX)

## Update v0.8.3
- New: New tab name incremental naming

## Update v0.8.2
- Added: Tabs can be reordered via drag & drop
- Fixed: Deleting a document now destroys its corresponding tab to avoid stale tabs
- Fixed: Adjusted library sidebar auto-refresh timing to avoid potential UI blocking on Linux
- Improved: Built-in “AI Assistant” upgraded to v0.3.8: default truncation increased to 128K characters
- Fixed: Built-in “Floating Rich Text Toolbar” upgraded to v0.1.6: in WYSIWYG mode, after inserting a link the caret can exit the link node correctly

## Update v0.8.1
- Added: Resizable split view (drag to adjust the ratio)
- Added: WYSIWYG supports HTML rendering; optional HTML editing can be enabled in Theme settings (off by default) and will be converted back to Markdown
- Improved: Built-in flymd-RAG upgraded to v0.1.3: adds file fingerprinting, incrementally re-embeds modified documents and cleans up stale chunk references; index sync temporarily disabled (risk > benefit)
- Improved: Built-in “AI Assistant” upgraded to v0.3.7: shows knowledge-base citation paths; adaptive chat window sizing

## Update v0.8.0
- Added: Font size setting (applies consistently across Source/Preview/WYSIWYG views)
- Improved: Unified default font size to 16px (Source/Preview/WYSIWYG are consistent)
- Improved: Built-in “AI Assistant” chat now supports KaTeX formulas and uses a wider content layout
- Fixed: “Save as PDF” could be truncated and lose styles; export now preserves layout/styles

## Update v0.7.9
- Fixed: When the OS is in dark mode but the user explicitly turns off Night Mode , the UI could still render with dark-theme artifacts

## Update v0.7.8
- Fixed: WebDAV sync scanning no longer skips required hidden paths; `.flymd/library-id.json` and extension-registered extra prefixes (e.g. flymd-RAG `.flymd/rag-index/<libraryId>`) can now be uploaded/synced correctly.
- Improved: Built-in flymd-RAG upgraded to v0.1.1; toggling “Cloud Sync” in settings now refreshes WebDAV extra sync paths immediately to avoid stale index sync state.
- Fixed: In the extension marketplace, third-party homepage links may fail to open for certain URL formats; URLs are now normalized .
- Improved: Extension marketplace dialog layout and scroll area styling (wider/taller/denser spacing).
- Improved: Built-in AI Assistant upgraded to v0.3.4; adds a new “Explain” quick action, and Continue/Polish/Correct now prefer selected text when available; marketplace copy renamed to “AI Assistant”.

## Update v0.7.6
- Added: The Extensions panel now shows plugin provenance (Official / Third-party) and a safety notice for third-party extensions.
- Added: Published a third-party extension “EasyImage2.0 Uploader”, which can upload images to a custom Web API by configuring URL, field names, and JsonPath.
- Changed: Knowledge-base index storage is now fixed under the library root at `.flymd/rag-index/<libraryId>`, and a stable library ID is stored in `.flymd/library-id.json` for cross-device consistency; custom index directories are no longer supported (if you previously used a custom index directory, you may need to rebuild the index or migrate it manually).
- Improved: The plugin host exposes a WebDAV plugin API so extensions can register extra sync paths and subscribe to sync-complete events, enabling cross-device sync for index/cache data.
- Fixed: AI Assistant chat rendering incorrectly parsed unordered lists in some cases, which could drop list content.
- Improved: Renamed the built-in image hosting settings entry from “Image Host” to “Image Host (S3/R2)” for clarity.

## Update v0.7.5
- Added: Published the official “flymd-RAG Knowledge Index” extension, which builds vector indexes for local Markdown/TXT libraries, enabling semantic search over your vault and serving as the backbone for RAG-style knowledge conversations.
- Added: AI Assistant can optionally integrate with flymd-RAG and, before sending a request, run semantic search and append cited snippets from your vault so answers can combine “current chat + local knowledge”; when flymd-RAG is not installed or disabled, existing behavior remains unchanged.
- Added: Extended the plugin runtime with library-wide file listing, directory watching and per-library plugin data directories, giving knowledge-indexing extensions a more robust foundation and making it easier for other plugins to build lightweight indexes.
- Improved: flymd-RAG Knowledge Index now supports incremental indexing and better recall strategies, only reindexing changed files and significantly reducing wait times on large libraries.
- Improved: flymd-RAG adds advanced options such as custom index directory and per-document index rebuild, along with richer progress and error reporting to help diagnose indexing issues.
- Improved: Completed English UI and copy for both flymd-RAG and the AI Assistant integration so knowledge-base search works seamlessly in English environments.
- Added: AI Assistant now includes a built-in free vector/LLM mode that can power flymd-RAG indexing without requiring your own API key (within the free quota limits).

## Update v0.7.4
- Added: Published the “Property View” extension, which shows document metadata fields in a column-based sidebar table so you can browse and filter your library by properties as a foundation for attribute-driven knowledge management.
- Added: Published the “Notes & Tasks Calendar” extension that aggregates todos and notes by day on a calendar view, letting you scan and jump to tasks directly from the calendar.
- Added: Published the “Knowledge Whiteboard” extension with a dedicated canvas for nodes and edges that can link back to existing notes, helping you lay out knowledge structures visually.
- Improved: The AutoYAML Metadata extension now works together with the Property View, auto-filling front matter so that properties appear directly in the property table and are easier to maintain.
- Improved: Completed English dictionaries and in-app copy for extensions such as the high-precision PDF parser, MinerU parser and Smart Floating Toolbar, so users in English locale get full prompts and descriptions.
- Improved: Extended the i18n runtime with a `flymd:localeChanged` event so plugins can listen for language changes and re-register themselves or refresh UI copy to keep Chinese/English views in sync.
- Improved: After switching the app language, FastNote now shows a “please restart” suggestion to avoid display glitches caused by stale language state in some extensions or windows.

## Update v0.7.3
- Added: New “Extension Menu Manager” dialog under the “Plugins” menu that lists all context-menu entries and “Plugins” dropdown actions registered by extensions, letting you toggle visibility per extension to declutter the UI without uninstalling plugins.
- Added: Published the “AutoYAML Metadata” extension, which can automatically add YAML front matter to the current document (such as title and tags) and optionally call the AI assistant to generate tags and a summary, making it easier to maintain a more structured knowledge base.
- Improved: The Backlinks plugin now scans the YAML front matter at the top of each document for a `tags` field and folds those tags into its index and “related notes” logic, giving tag-driven vaults more accurate backlinks and recommendations.
- Improved: Completed English copy for the extensions marketplace and most official plugins (including Graph View, Backlinks, Git History, Word/Excel Importer, S3 Gallery, Typecho integrations, xxtui todo-push and AutoYAML Metadata), with manifests and plugin UIs now following FastNote’s language setting.
- Fixed: WebDAV sync status indicators no longer get stuck after enabling or disabling the built-in sync extension; switches in the extensions panel and related menus now reflect the current state immediately.

## Update v0.7.2
- Added: Official “Graph View” extension that builds a local relationship graph around the current note using the Backlinks index, rendered in a floating panel with clickable nodes and quick entries from the Plugins menu and editor context menu.
- Added: New “Smart Floating Toolbar” extension that pops up a draggable rich-text toolbar near the selection when you select text, with configurable heading hotkeys (Ctrl+1–6 by default) and quick actions for links, images and formatting.
- Improved: The floating toolbar can now be configured to “only show when there is a selection”, correctly distinguishes source / WYSIWYG / reading modes (and stays hidden in reading mode), adds a one-click “reset heading hotkeys” option, and uses new host APIs such as `getSourceCaretRect` / `onSelectionChange` so the toolbar can follow the caret precisely in source mode.
- Improved: The extensions marketplace is now prewarmed in the background when the app goes idle (overlay construction + first full render + market index fetch into the store cache), and category filters operate purely on the locally cached list; combined with cached installed/update state this makes the marketplace open almost instantly without extra network round-trips.
- Improved: Built-in entries for WebDAV sync and the S3/R2 uploader have been added to the main “Plugins” menu, making it easier to find and manage sync/image-bed settings from a single place.
- Improved: When you rename or move a file from the library sidebar, any open tabs tracking that file now update their paths and titles accordingly; closing tabs or exiting the app after edits now honours whether the save operation actually cleared the dirty state, so cancelling a “Save As” dialog or hitting a save failure no longer leads to accidental exits.

## Update v0.7.1
- Added: New “PicList Uploader” extension that lets you select local image paths or Markdown image syntax in source mode, upload them to a local PicList HTTP server with one click, and replace the selection with the hosted URL; an optional “auto upload after paste” switch can watch pasted `pasted-*` images and automatically upload + rewrite them.
- Added: PicList uploader is now integrated with WYSIWYG mode via paste/flush hooks so that the same auto-upload pipeline applies while editing visually, keeping behaviour consistent across modes.
- Added: Built-in “S3 Gallery” extension that aggregates images uploaded via the built-in S3/R2 uploader into a visual gallery, with thumbnail previews and actions to copy links, insert into the current note, or delete remote objects for easier image housekeeping.
- Added: Extension marketplace now supports category filters; together with the new “PicList Uploader”, “S3 Gallery” and “Flyshow Publish” extensions you can quickly discover storage/publishing tools under dedicated categories.
- Added: The plugin host now exposes new filesystem APIs (`readTextFile`, `writeTextFile`, `listLibraryFiles`) so extensions can safely read/write files inside the current library and enumerate Markdown documents, enabling richer plugin scenarios.
- Improved: The S3 uploader now persists upload history and exposes list APIs that can be reused by management-oriented extensions such as “S3 Gallery”, laying the groundwork for more advanced image-bed management features.
## Update v0.7.0
- Added: The Word/Excel Importer now extracts `data:`-URL images from the converted HTML, saves them as standalone files under an `images/` subfolder next to the current document, and inserts relative paths in the generated Markdown; the plugin runtime also exposes a new `saveBinaryToCurrentFolder` API so extensions can safely write binaries beside the current file and get back a path suitable for Markdown.
- Improved: In WYSIWYG mode, pasting images into an unsaved document no longer inlines them as base64 inside the text; instead they fall back to being stored in the system Pictures directory (matching source-mode behaviour), which keeps documents smaller and reduces memory spikes while editing.
- Added: The Backlinks plugin now decorates `[[name]]` text in the reading preview as clickable links that jump directly to the target note, with more robust parsing for patterns such as `[[Title]]`, `[[Title|Alias]]` and even WYSIWYG-escaped `\\[\\[...\\]\\]`.
- Improved: The Backlinks side panel is now closed by default and can be toggled from a unified “Show/Hide backlinks panel” entry in the editor/preview/WYSIWYG context menus, while fixes around preview-root handling make occasional broken link clicks far less likely.
- Fixed: On setups with multiple monitors or corrupted window state, the main window could grow beyond the virtual desktop or restore to absurd sizes; window sizing is now clamped against a Rust-side “virtual screen size” calculation while still enforcing a minimum of 960×640.
- Fixed: On macOS, the auto-updater now matches assets by preferring `.dmg` / `.pkg` / `.app.zip` and recognising “universal” builds, avoiding accidentally picking up Windows portable ZIPs and leading to more reliable in-app updates.

## Update v0.6.9
- Added: New “Backlinks” plugin built on `[[Title]]` wiki-style syntax that automatically builds forward and backward links between notes and exposes a side panel to inspect which notes reference the current document, with a one-click “rebuild index” action.
- Added: Backlinks panel now integrates AI-powered semantic related-note suggestions; under the current document you can see AI-picked related notes, left-click to open the note, or right-click to insert a `[[link]]` to it at the cursor.
- Added: New editor context-menu entries such as “Insert backlink” and “Refresh backlinks for current note”, making it easier to wrap selected text with `[[Title]]` links; when used together with the AI assistant plugin you can insert AI-recommended related notes with a single action.
- Improved: Source mode now has inline `[[title]]` completion; when you type `[[` in the plain Markdown editor, a suggestion box pops up listing notes from the current library and you can pick one with arrow keys + Enter (note: title completion for backlinks is currently only available in source mode; WYSIWYG mode automatically disables this feature).
- Improved: The “PDF & Image High-Precision Parser” extension now downloads remote images to local storage and reads them via the plugin runtime, reducing the chance of broken images when CDN links expire.
- Fixed: On macOS, double-clicking document icons or opening files/libraries from Finder on a cold start could fail to deliver the path to FastNote; path handling has been hardened so these entry points behave more reliably.
- Fixed: In some multi-monitor setups with certain resolution/DPI combinations, the main window could grow abnormally large or beyond screen bounds; window sizing has been adjusted to stay within a reasonable range.
- Misc: WYSIWYG v2 now handles bracket escaping and image paths more carefully so Obsidian-style `[[links]]` survive mode switches as much as possible, and several internal implementation details have been cleaned up.

## Update v0.6.8
- Added: A “Paste as plain text” entry in the context menu so you can insert stripped text in any mode without bringing over messy styles from web pages or rich-text editors.
- Improved: The source-mode paste conversion pipeline for HTML → Markdown, reducing extra blank lines, broken lists and other formatting glitches so pasted content stays closer to the original semantics.
- Added: Published the “Word/Excel Importer” extension that parses common Office documents and imports them as Markdown into your current library, making it easier to consolidate scattered materials.
- Improved: Moved the “Config backup” and “Portable mode” switches into the File menu, simplifying the context menu and keeping frequent actions under a clearer entry point.
- Fixed: A portable-mode issue that could lead to the document library path being lost or unintentionally cleared, improving safety when running from USB drives or portable bundles.

## Update v0.6.7
- Added: Markdown footnote syntax support (`[^1]` / `[^name]`) so both source and reading modes render proper footnote sections, keeping annotations structured in long documents.
- Improved: Footnote markers in reading mode now show a tooltip with the full footnote content near the reference, reducing scroll back-and-forth when looking up notes.
- Added: Published the “Git Version Control” extension, bringing a VS Code–style Git sidebar to FastNote with history list and inline diff highlighting for the current library and the current document.
- Added: Extended the runtime with Git command bridge APIs that only allow safe operations such as status inspection, history querying and explicit commits, avoiding destructive actions on existing repositories.
- Misc: Polished error handling and safety checks around Git-related features to lay groundwork for future version-control-centric extensions.

## Update v0.6.6
- Added: Source mode now supports a “Source + Reading” split view with editor on the left and live preview on the right, keeping scroll positions in sync and making large-screen writing more comfortable.
- Improved: Split view is hardened with window-width guard rails, auto-exit when switching modes or files, and debounced preview refresh to keep the layout stable on narrow windows.
- Added: File deletion in the library sidebar now uses an in-app JS confirmation dialog instead of the native system dialog, providing clearer copy, consistent styling and reducing the risk of accidental deletes.
- Added: WYSIWYG mode now understands `<!-- ... -->` HTML comment nodes so comment blocks in Markdown are preserved instead of being silently dropped during rendering.
- Added: New “Upload to image host (S3/R2)” entry in the image context menu that reads the underlying local file, uploads it to object storage and copies the generated Markdown link to the clipboard without touching current document content.
- Added: Autosave capability on desktop environments that can write files, periodically saving the current document in the background and persisting the toggle state to reduce data loss on unexpected exits.
- Fixed: Undo right after pasting text in source mode could clear the entire document; undo now only reverts the latest paste operation.
- Misc: Small tweaks to the PDF-to-Word plugin and related details to improve stability and compatibility.

## Update v0.6.4
- Added: Extension runtime now exposes `context.getLibraryRoot` and `context.saveMarkdownToCurrentFolder`, so plugins can safely read/write Markdown files inside the current library, enabling richer local automation flows such as PDF parsing and translation.
- Improved: The “PDF & Image High-Precision Parser” extension now supports automatic paginated translation for large PDFs and shows a confirmation dialog before starting long-running translation tasks, reducing accidental heavy jobs and quota waste.
- Improved: The document library now watches the filesystem and refreshes automatically when third-party tools create, delete or modify files under the library root, keeping the sidebar in sync with the actual folder contents.
- Improved: Library sidebar context menu positions itself within the visible window to avoid being clipped off-screen, and the `D` / `M` keyboard shortcuts have been removed to eliminate rare accidental triggers.
- Improved: When creating a new document or folder from the library sidebar, FastNote now prompts for a name first and only then creates the underlying file or directory, avoiding piles of “untitled” entries.
- Fixed: Reverted the dark-mode behavior change introduced in v0.6.3 and temporarily restored the “auto-enable dark theme when the OS is in dark mode” logic to fix dark-theme issues on some platforms.
- Docs: Updated README and plugin development docs to cover the new extension APIs and the latest usage notes for the MinerU PDF/Image parsing extension.

## Update v0.6.3
- Added: Published the official “MinerU PDF/Image Parser” extension, which uses the MinerU API to structurally parse PDFs and images, providing an alternative pipeline for complex scans and mixed image+text documents.
- Added: Published the “Send to Blinko” extension, adding a context-menu entry to send the current content to Blinko in one click.
- Improved: Upgraded the “PDF & Image High-Precision Parser” extension to support direct image parsing and one-click PDF translation, making it more effective on handwritten, complex-layout and multi-language documents.
- Improved: Updated the AI assistant extension and its model list, removing support for the Qwen3-Omni model.
- Improved: Removed the logic that force-enables dark theme when the OS is in dark mode; theme light/dark now strictly follows FastNote’s own setting so users have full control regardless of system appearance.
- Improved: Library sidebar now forcibly disables background grid patterns and always uses a solid background, keeping document lists readable under all themes.
- Fixed: Incorrect title extraction in WYSIWYG mode that could cause the window title to diverge from the actual document title.
- Fixed: The xxtui todo-push extension now preserves the original Markdown text when sending tasks and reminders instead of losing formatting.
- Refactored: Split the file library, todo mode, focus mode, sticky notes, plugin host & settings panels, image-hosting configuration, context menus, update window and more into dedicated runtime/UI modules, consolidating core capabilities into reusable extension-style building blocks that reduce coupling and prepare for a richer extension ecosystem.

## Update v0.6.2
- Added: Published the official “PDF High-Precision Parser” extension powered by large models, which converts PDFs into Markdown or docx with better layout preservation and support for handwriting, formulas and tables, including one-click “To MD / To Docx” actions for the currently opened PDF.
- Added: Extension runtime now exposes `getCurrentFilePath` and `readFileBinary` APIs so plugins can read the current document as raw bytes by absolute path, enabling scenarios such as PDF parsing and image processing.
- Improved: Sticky Note mode windows now hide their taskbar icons on desktop platforms, making them feel more like native sticky notes and freeing up taskbar space.
- Fixed: When “Default WYSIWYG mode” was enabled, opening a PDF by double-clicking could force WYSIWYG mode and break PDF preview; the dedicated PDF viewer is now preserved and WYSIWYG auto-switch is skipped in this case.
- Improved: Updated README and project configuration to reflect the new extension and related workflows.

## Update v0.6.1
- Improved: In WYSIWYG mode, unordered lists now use `-` instead of `*`, keeping list markers consistent with source-mode Markdown and making copy/paste comparisons easier.
- Added: The xxtui todo-push extension now supports configurable write-back markers and a refactored settings panel navigation, so advanced workflows are easier to configure.
- Improved: The code block language selector in WYSIWYG now automatically hides once the caret leaves the code block, reducing visual noise while typing.
- Improved: Empty Mermaid blocks in WYSIWYG automatically enter edit mode, and symbol auto-completion is disabled inside code blocks to avoid fighting with normal coding habits.
- Improved: Mermaid diagrams show clearer error hints on failures and several WYSIWYG rendering edge cases are fixed, making diagrams more stable and diagnosable.
- Fixed: Multiple KaTeX editing issues, including the Delete key not working, formulas not activating on mouse click, double-click glitches and styling problems, so formula editing feels closer to plain text.
- Improved: Added several small helper hints and labels in the UI so new features are easier to discover and understand.

## Update v0.6.0
- Added: Custom typography controls in the Theme panel (line height, paragraph spacing, content max width and first-line indent), so you can tune the reading/WYSIWYG/source layouts to your own taste.
- Added: A “Default source mode” toggle; when enabled, FastNote always opens documents in source mode instead of auto-switching to preview.
- Added: In WYSIWYG mode, automatic pairing / wrapping / paired deletion for both Chinese and Western brackets & quotes, scoped to the ProseMirror view so it does not interfere with source-mode typing.
- Improved: Typing ``` and pressing Enter in WYSIWYG mode now instantly creates a framed code block with language selector, with better keyboard navigation and more robust handling of $$ math blocks.
- Improved: First-line indent now only applies to top-level paragraphs, no longer affecting Mermaid diagrams or code blocks; dedicated Mermaid styles in WYSIWYG avoid truncated Chinese labels and layout glitches.
- Improved: The bracket wrapping logic and caret positioning in WYSIWYG have gone through several refinement rounds, fixing issues like “caret only enters on the first line” and making the editor feel more like a word processor.
- Fixed: In 0.5.9, window control buttons could disappear when compact titlebar was disabled on some platforms; this has been corrected and an old Win32 style hack removed so titlebar behavior is more predictable.

## Update v0.5.9
- Added: Custom color theme controls plus a "parchment" style toggle, making it easier to tune contrast and create long-form reading themes.
- Improved: Custom colors can now apply globally across the app, and background color layers are simplified so the editor, sidebar and chrome feel more consistent in both light and dark themes; sidebar buttons, the plugin menu and compact title bar window controls are all aligned with the updated visual system.
- Improved: Removed the native Windows window border so compact title bar mode looks fully integrated with the rest of the UI on Windows.
- Improved: WebDAV sync now scans directories and transfers files with higher concurrency (up to 8 parallel tasks) and introduces retry with exponential backoff, making sync throughput and reliability more stable on shaky networks.
- Improved: Switching between Source / WYSIWYG / Reading modes now shows a small notification bubble for the current mode, and all "Edit mode" labels are renamed to "Source mode" to keep terminology consistent.
- Added: WYSIWYG mode now supports deleting code blocks directly, and nodes that support double-click editing (Mermaid, KaTeX, images) gain dedicated delete buttons for quick cleanup.
- Fixed: Issues with the KaTeX delete button in WYSIWYG mode and a bug where sidebar buttons did not follow global theme settings.

## Update v0.5.8
- Added: Global body font toggle that lets your custom text font apply to the entire UI (menus, buttons, plugin windows) and a shared monospace font variable used by the editor, preview and AI assistant so typography stays consistent across the app.
- Added: Custom font manager in the theme panel that lists installed fonts and lets you delete them, automatically cleaning up font files, injected styles and any theme preferences that reference removed fonts.
- Improved: Switching between Edit, WYSIWYG and Reading modes now keeps the viewport and scroll position aligned so the text under your cursor no longer jumps when you flip modes to compare formatting.
- Improved: Reading mode code blocks in dark mode now use consistent syntax highlighting and backgrounds with the editor, restoring contrast and readability at night.
- Improved: The extension marketplace now uses a stable sort order (built-in, recommended, then A–Z by name), adds an "Updatable" filter, and proactively invalidates cached metadata when sort rules or structure change so you always see fresh plugin lists.
- Improved: Sticky note mode now ignores global dark mode and refines its toolbar buttons, while the native context menu is disabled on notes to avoid accidental right-click actions on small note windows.
- Improved: Focus Mode and main menu buttons receive layout and spacing tweaks for clearer hierarchies and more predictable hit targets, aligning controls with the compact title bar design.
- Improved: AI assistant dark mode styling and the Vision toggle appearance are tuned to match FastNote’s night theme, with code snippets honoring the global monospace font setting.
- Fixed: Restored window dragging on Linux and macOS when compact title bar mode is enabled so you can still drag the window from inside FastNote even when the native title bar is hidden.

## Update v0.5.7
- Added: Compact title bar mode with custom window controls drawn inside FastNote, toggled from the theme panel and persisted between launches, including integration with Focus Mode so the native title bar can be fully hidden.
- Added: Syntax highlighting for code blocks in WYSIWYG mode plus a compact icon-style copy button that adapts to light/dark backgrounds for easier reading and copying of long code snippets.
- Added: Typecho Manager upgrades including editable title in the download/publish dialog, automatic title fallback from the current file name, a new API that renames the local Markdown file to `ID-title` after publish, and better compatibility with themes that rely on a top-level `thumb` field.
- Added: Third-party "Xiaohongshu copywriting generator" AI extension, now listed in the marketplace and acknowledged in the Chinese and English READMEs.
- Improved: Night mode backgrounds for edit, WYSIWYG, reading and surrounding chrome (sidebar/menu/tabbar) with a new derived color model that keeps chrome visually close to the content area and avoids overly bright or overly dark bars.
- Improved: Chrome colors for the title bar, menu bar, sidebar and tab bar now track the active mode (edit / WYSIWYG / reading) and theme, updating automatically when switching modes or changing theme preferences.
- Improved: Images in WYSIWYG mode can be double-clicked to edit their source URL; the original local path is preserved in a dedicated attribute so you no longer see or edit `base64` / `asset:` intermediate URLs.
- Improved: URL pasting behavior is now unified between edit and WYSIWYG modes — pressing `Ctrl+V` on a plain URL fetches the page `<title>` and inserts a link, powered by a shared `flymdFetchPageTitle` helper.
- Improved: The insert-link dialog now focuses and selects the URL field by default for quick paste-to-replace, and the "+" tab button is always rendered as the last item so tabs align more predictably.
- Fixed: Mermaid diagrams and code highlighting colors in dark mode to restore contrast and readability; WYSIWYG background color controls are disabled in dark mode to avoid unreadable combinations.
- Fixed: A case where Backspace on an empty input could bubble up and close the dialog; Backspace at the start of text inputs/textareas is now intercepted so focus safely remains in the field.

## Update v0.5.6
- Added: Official "Typecho Post Manager" extension that uses XML-RPC to fetch posts from Typecho, filter by date/category, and download them as local Markdown files, and it is now listed in the built-in extension marketplace.
- Added: Typecho Manager now supports creating and publishing posts directly from FastNote, editing slug/cover/custom fields, and lazily loading categories from the remote site on first publish to reduce manual configuration.
- Added: New `context.htmlToMarkdown` API for extensions, allowing plugins to convert HTML returned by Typecho, WordPress or arbitrary web APIs into Markdown with optional `baseUrl` to resolve relative links.
- Added: Built-in free Gemini Vision model in the AI Assistant so you can choose "Gemini Vision" under the free provider, with a dedicated "Bohe Gongyi" badge and link when that channel is used.
- Improved: Typecho Manager now supports keyword search, bulk download of selected posts, and smarter default download directories (relative or absolute), and automatically refreshes the file tree after pulling articles so your library view stays in sync with disk.
- Added: Advanced Typecho management tools including related-post suggestions based on the current document, per-blog statistics/health checks, and safe remote snapshots with rollback history so you can restore previous versions if a publish overwrites server content.
- Improved: Front Matter handling when downloading or publishing Typecho posts, preserving excerpt/cover/custom_* fields in YAML and writing them back after publish so local Markdown stays aligned with remote metadata.
- Added: Auto-hide scrollbars across editor, preview and library with hover-to-show behavior, plus a compact Front Matter summary bar at the top of Reading mode (title, categories, tags, status, slug/ID, date, source) with a toggle to show or hide it.
- Improved: Error handling for free models — when you hit rate limits or the daily free quota, the assistant now shows clear messages with the reason and suggested wait time instead of blindly retrying 429 responses.
- Improved: Applied a 1MB size limit to local images used in Vision mode and paste; oversized images are skipped with explicit warnings to avoid overloading requests, and fixed AI plugin docking so hidden windows no longer keep squeezing the editor area.
- Improved: Outline panel can be detached from the library into its own column, letting you switch between "Library | Outline | Editor" and "Library | Editor | Outline" layouts; when a plugin window docks on the right, the outline automatically shifts left, alongside visual polish to the library/sidebar, scrollbars, status bar and a Linux fix that forces an opaque background to avoid transparent/blank windows on Arch-like distributions.
- Fixed: Installed local fonts are now re-registered on launch so font selections like "Local: XXX" continue to work correctly after upgrading or restarting.

## Update v0.5.5
- Added: AI vision capabilities that let the assistant directly read local images and call vision models for understanding and analysis, including a time-limited free vision model to make it easier to try.
- Added: New window layout APIs for the extension system, enabling a three-column layout ("library sidebar + AI panel on the left + editor") and dynamic plugin positioning so right-docked and bottom-docked plugin panes avoid overlapping each other.
- Added: Exposed a YAML Front Matter and parsed metadata API so plugins can read the document front matter in a unified way, useful for blog publishing, library enhancements, and external app sync.
- Added: Published the third-party "Telegraph-Image" image hosting plugin in the extension marketplace so you can upload images to Telegraph in one click and get back shareable links.
- Improved: Layout behavior of AI plugin windows and bottom plugin panes in WYSIWYG mode so they no longer cover the tab bar and correctly push the editor area instead of overlapping it.
- Improved: Error handling around local and hosted images with size/limit prompts and fallback strategies, and fixed cases where images in dialogs or source mode could not be recognized by the AI.
- Fixed: Library sidebar drag-and-drop sorting now persists correctly, and several CORS-related issues and other edge cases have been resolved for a more stable overall experience.

## Update v0.5.4
- Added: AI chat can now link with Sticky Notes so you can quickly turn replies into notes or todos and keep ideas from getting lost.
- Improved: Default Sticky Note spawn position so new notes appear closer to the current document and area of focus, reducing manual dragging.
- Added: Custom drag-and-drop ordering for the sidebar tree so you can arrange documents in whatever order best matches your workflow.
- Improved: PDFs are now sorted separately from Markdown files in the library while still honoring your custom sort order, and deprecated custom library icons have been removed.
- Improved: PDF items are now distinguished by text color instead of a red dot, making the file list cleaner and less visually noisy.
- Improved: WebDAV sync defaults — newly created libraries start with WebDAV sync disabled to avoid accidentally syncing into an old library; once a sync path is configured, the setting follows library switching.
- Fixed: Added an explicit prompt when WebDAV is not configured and fixed a bug where the sync conflict dialog might fail to appear, reducing the risk of silent conflicts.
- Docs: Updated README and corrected the PackyCode link formatting.

## Update v0.5.3
- Added: Extension marketplace search for extension name, author, and description, plus GitHub / Official channel switching, an "installed only" filter, and a "Featured" badge with clearer card layout and loading states.
- Added: "Markdown Table Helper" marketplace extension that lets you quickly insert Markdown tables at the cursor, working together with WYSIWYG mode for a more spreadsheet-like editing experience.
- Improved: Unified table styling across Edit / Reading / WYSIWYG modes with light/dark-aware table color variables for borders and headers, boosting contrast and readability on dark backgrounds.
- Improved: Theme settings panel with new typography presets ("Tech", "Literary"), a new "Minimalist" Markdown style, and additional eye-friendly palettes (Tea Green, Paper White, Soft Pink), plus a tighter overall layout.
- Improved: Extension manager now uses incremental updates and background refresh of marketplace data when reopening the panel, avoiding full re-renders while still allowing a manual "Refresh" to force updates.
- Fixed: Visual inconsistencies in table borders/header colors under dark mode and some themes, and several styling issues in the extension manager when using dark themes.

## Update v0.5.2
- Added: Switched collaboration mode to a JS-driven custom cursor with clearer color differentiation, aligned cursor colors in the collaboration plugin, and bundled an official collaboration server option to make multi-user sessions easier to recognize and join.
- Improved: Refined WYSIWYG editing styles for KaTeX and other inline math, together with a cleaner baseline layout for the plain Edit mode so long-form editing and reading feel more consistent.
- Fixed: A series of WYSIWYG issues where Mermaid/Math NodeViews were constantly rebuilt (causing scrolling glitches), duplicate scrollbars appeared, and the code-block copy button stopped working, greatly improving stability.
- Fixed: Missing syntax highlighting for code blocks in WYSIWYG, blank Mermaid diagrams, and failures when opening PDFs from that mode, covering several rendering/export edge cases.
- Improved: Sticky Note mode styling and layout, including automatic height adjustment based on content, and fixed layout glitches that could appear when launching sticky notes from WYSIWYG mode.
- Added: New "Generate tag" and "Open in new instance" entries to the sidebar tree context menu to speed up multi-library and multi-window workflows.
- Fixed: Reading mode sometimes falling back to a pure white background under certain themes, and introduced a compatibility tweak for Arch Linux AppImage builds affected by WebKitGTK / GPU driver interactions that could cause white-screen issues.

## Update v0.5.1
- Added: Open collaborative editing support with an open-source FastNote collaboration server sample (the `OSserver` directory) and the companion "Collaboration (Open Server)" extension, enabling room + password based multi-user editing on your own server (Beta).
- Added: Plugin host APIs for registering/consuming custom namespaces and listening to source-editor selection changes, providing the foundation for collaboration and other advanced extensions.
- Improved: File-tree click/double-click integration with the multi-tab system to avoid tab mix-ups or overwritten content when using Ctrl+click or switching libraries.
- Improved: Editor layout sizing and scrolling logic, fixing cases where repeated Enter presses could push the menubar/tabbar off-screen and where edit/preview area heights were miscalculated.
- Fixed: Layout glitches where using `Ctrl+Shift+V` to paste long "plain text" could make the menubar/tabbar disappear or become inconsistent.

## Update v0.5.0
- Added: Sticky Note mode to open the current document in a compact, dedicated note window that automatically switches to Focus + Reading mode, hides the sidebar, and keeps only the content area—ideal for todos, small reference notes, and ideas that should stay on the desktop.
- Added: Sticky Note controls with round "Lock position" and "Always on top" buttons, so you can disable window dragging to avoid accidental moves and keep notes floating above other apps.
- Added: Enhanced tab right-click menu with "Open in new instance", direct file rename on disk, and one-click "Create sticky note" from the current tab.
- Added: Sticky Note mode now supports quick todo input—type a line, press Enter or blur the field to jump back to Reading mode, and completed items get automatic strikethrough so notes work better as a lightweight todo board.
- Added: Integrated "Push" and "Remind" buttons into Sticky Note headers to send notes directly into the xxtui todo list and schedule reminders; new host APIs for the xxtui todo-push plugin and AI Assistant enable right-click actions "Generate todo" and "Generate & create reminder" that turn selected text into structured tasks.
- Improved: AI Assistant replies now support Markdown rendering and code highlighting, making long answers and code snippets much easier to read.
- Improved: AI requests gain automatic retry with a clearer "thinking…" indicator, while long-running operations like translation use a persistent, dismissible notification bar instead of transient toasts.
- Improved: Reworked the editor undo/redo logic with per-tab undo stacks so switching tabs or WYSIWYG modes no longer corrupts or mixes up your undo history.
- Fixed: Some extensions' long-running notifications either failed to stay visible or could not be dismissed correctly when using the unified notification API, and several scrolling/offset glitches in WYSIWYG mode plus code-copy button positioning in long documents.

## Update v0.4.8
- Added: WebDAV sync now supports end-to-end encryption, encrypting file contents locally before upload so even compromised servers cannot easily read the plaintext.
- Added: Restored the OMG preset endpoint and signup link in the AI Assistant settings for quick access to the OMG resource bundle.
- Added: More theme background options and Markdown layout presets, together with a refreshed layout for the theme settings panel.
- Fixed: WYSIWYG bold/italic shortcuts sometimes leaving the caret in the wrong position.
- Fixed: WYSIWYG code-block copy button becoming misaligned when used inside long code blocks.
- Fixed: Tauri HTTP scope validation so legitimate HTTP/HTTPS requests are no longer blocked by overly strict rules.

## Update v0.4.7
- Added: Full configuration export/import so you can back up or migrate all FastNote settings, extensions, and cache data in one shot.
- Added: Portable Mode to store config alongside the app root, making it easy to carry FastNote on a USB drive.
- Added: Tab right-click menu so actions like closing or pinning a tab can be done directly on the tab bar (details will be iterated in later builds).
- Improved: Adjusted `Ctrl+N` behavior to better fit the multi-tab workflow so new files and new tabs behave more intuitively together.
- Improved: When all tabs are closed, FastNote now returns to a blank document in edit mode instead of leaving you in a “no document” state.
- Improved: Unified the plugin notification system through a top notification center and exposed new `showNotification / hideNotification` APIs for extensions.
- Improved: In the AI Assistant extension, the “Continue / Polish / Correct” quick actions can now focus only on the selected text, making right-click workflows selection-aware.
- Added: Reserved keyboard shortcut `Alt+W` for closing the current tab .

## Update v0.4.6
- Added: Right-click context menu items now support drag-and-drop sorting with persistent storage, while built-in entries stay locked to prevent mistakes.
- Added: Exit prompts and WebDAV conflict/delete confirmations are replaced with custom three-button dialogs (Save / Discard / Cancel) so every choice is explicit.
- Improved: On launch the app reads the OS dark preference, automatically forces night mode when appropriate, and ships refreshed tab-bar polish for dark themes.
- Improved: The extension runtime exposes a static asset URL helper, letting the AI assistant bundle avatar/fallback resources so icons render even offline.
- Fixed: Switching tabs no longer falsely marks documents as dirty, so confirmation dialogs only appear when real edits exist.

## Update v0.4.5
- Added: WebDAV sync now exposes a HTTP host whitelist so plaintext sync only runs against explicitly trusted hosts/ports, blocking accidental connections to unknown nodes.
- Improved: The sync dialog gains inline whitelist rows with + / - controls and empty-state hints, always keeping at least one editable input for smoother configuration.
- Improved: WYSIWYG edits now trigger the outline refresh pipeline and code-copy buttons always emit Markdown fences with language info for cleaner paste results.
- Fixed: Reworked the WYSIWYG `Ctrl+B / Ctrl+I` shortcuts to wrap selections directly in the Markdown source so the commands keep working even after focus hiccups.
- Improved: Save operations broadcast to the tab system, which instantly refreshes tab paths and clears the dirty asterisk after Save / Save As flows.
- Improved: Tauri request security is refactored to isolate the default HTTP scope into a dedicated `http:allow-fetch` role, limiting network access to declared URLs.

## Update v0.4.3
- Improved: macOS build upgraded to Universal Binary—single installer supports both Intel and Apple Silicon with native performance for each architecture
- Improved: Resolved build failure caused by GitHub Actions deprecating macos-13 runner
- Improved: Simplified macOS release process—users no longer need to distinguish between Intel and ARM versions

## Update v0.4.2
- Added: Multi-tab editing with `Ctrl+T` new tab, `Ctrl+Tab / Ctrl+Shift+Tab` tab cycling, plus `Ctrl + Left Click` to open docs in background tabs for parallel editing
- Added: Library sidebar now has dedicated rename/delete shortcuts so hopping between files in the new tab system no longer requires constant mouse travel
- Added: WYSIWYG code blocks gain a one-tap copy button, making it easier to share snippets or paste commands elsewhere
- Added: Plugin marketplace accepts local installation sources so you can side-load or debug private extensions completely offline
- Improved: WebDAV sync allows plain HTTP connections and the settings panel layout is refreshed, simplifying LAN / self-hosted NAS setups
- Improved: Theme dialog and AI conversation windows receive new placements, bubble styles, and z-index fixes so dark-mode toggles no longer cause flicker
- Improved: AI chats can create todos and reminders directly in the thread while document-context actions stay in the right-click menu workflow
- Fixed: Restored Delete key text editing instead of deleting files, refreshed outline updates in Edit mode, let inline code exit correctly in WYSIWYG, and resolved sporadic top-bar occlusion to stay compatible with prior releases
- Fixed: WebDAV sync skipping file updates in certain scenarios

## Update v0.4.1
- Improved: Library sidebar open/close state is now persisted and restored across restarts and mode switches; first open automatically refreshes the tree to prevent empty panels
- Fixed: Focus Mode no longer hides the folder toggle arrows, so the library tree remains expandable even when WYSIWYG/Focus Mode is active
- Improved: WebDAV sync dialog now defaults the “Enable / Sync on startup / Sync on shutdown” toggles to OFF—sync only runs after you explicitly opt in

## Update v0.4.0 
- Added: Dark mode toggle in theme settings — manually switch to dark theme with auto-saved state
- Added: Dark mode fully optimizes text display across all windows including library sidebar, dialogs, editor, and WYSIWYG mode
- Added: AI Assistant now defaults to free model mode with deep SiliconFlow integration — built-in free AI service works out of the box, no API key configuration needed
- Added: Free model mode displays "Powered by SiliconFlow" entry in context menu, one-click jump to register for premium model experience
- Added: AI assistant extension now auto-installs silently in the background after first app launch, so new users don't need to open the marketplace manually
- Added: AI assistant exposes `callAI / translate / quickAction / generateTodos` APIs so other plugins can reuse the AI capabilities directly
- Added: Context menu now includes WebDAV sync, sync log viewer, and image hosting toggle shortcuts for more convenient operations
- Added: Custom context menu shows "Hold Shift + Right Click to open native menu" hint to prevent confusion when native menu is overridden
- Added: xxtui todo push plugin 0.1.5-beta introduces a unified missing-API-key dialog and embeds QR/link instructions in settings so users can quickly obtain keys
- Added: WYSIWYG mode now fully supports AI extension capabilities — AI Assistant can instantly read/write content in WYSIWYG mode without switching back to source mode
- Added: AI toolbar now includes a Custom/Free mode toggle and free mode lets you switch between Qwen and GLM models on the fly
- Added: Translation can be configured to always use the free model even when custom mode is active, preserving paid quotas
- Improved: Theme settings toggle layout optimized to three columns — Focus Mode, WYSIWYG Mode, Dark Mode at a glance
- Improved: AI settings Base URL dropdown is reordered to place SiliconFlow first and uses it as the default custom endpoint
- Improved: AI dialog window now includes boundary checks to ensure at least 100px remains visible when dragging, preventing window loss
- Improved: Optimized extension settings window display logic, fixed issue where settings dialog wouldn't appear after AI window was closed
- Improved: WebDAV sync logs now use local timestamps for better readability; logs auto-truncate when exceeding 5MB to prevent unbounded growth
- Improved: Library sidebar now includes a “Switch Side” button to dock the library on the left or right; Focus Mode window controls automatically swap sides to avoid overlaps
- Improved: Library tree remembers folder expansion states per library, so your last browsing context is restored after restart
- Improved: Library action buttons force horizontal text flow so Chinese labels no longer break into two lines
- Fixed: WebDAV sync notification bubble being obscured by UI in Focus Mode, ensuring sync prompts display properly
- Fixed: Focus Mode sidebar expand button not displaying on first open
- Fixed: "Default to WYSIWYG Mode" setting not taking effect after application restart

## Update v0.3.9
- Added: Focus Mode — borderless immersive writing experience. Press `Ctrl+Shift+F` to enter, hiding the title bar, menu bar, and all UI elements, leaving only a clean editing area.
- Added: Sidebar toggle button in Focus Mode to quickly hide/show the document library sidebar.
- Added: Focus Mode exit button `</>` styled consistently with window control buttons.
- Added: "Default to WYSIWYG Mode" toggle in theme settings — when enabled, files automatically open in WYSIWYG mode.
- Improved: Hide status bar (row/column/word count) in WYSIWYG and Reading modes for a cleaner interface.
- Improved: Edit mode sidebar color now follows the theme for a more unified visual experience.
- Improved: WYSIWYG mode layout optimization in Focus Mode.

## Update v0.3.8
- Added: The AI assistant now offers a "Free model" mode powered by a built-in SiliconFlow small model so newcomers can chat without configuring any API key.
- Added: A new "Translate" action translates the current selection (or the entire document) into fluent Chinese and inserts the result as quotes/sections.
- Added: Extension APIs expose `context.getPreviewElement` and `context.saveFileWithDialog`, enabling plugins to read the rendered preview DOM and open native save dialogs; the plugin guide includes matching examples.
- Improved: The AI settings dialog switches to a toggle-based mode selector with warnings that clarify the trade-offs of the free model.
- Improved: WebDAV sync scans remote folders with higher concurrency and shows upload/download/delete summaries inside the completion bubble for easier auditing.
- Improved: The extensions list repositions the "standalone view" toggle on each card and the top toolbar hover animation is simplified for a steadier UI.

## Update v0.3.7
- Added: AI assistant now integrates with xxtui todo plugin, enabling "generate and create reminder" functionality via plugin API
- Added: AI assistant extension now includes current time and time context from article content for better time-related Q&A accuracy
- Added: AI assistant extension now has a right-click menu entry
- Added: Extension system now supports inter-plugin communication API, allowing plugins to call each other
- Added: xxtui todo push plugin now supports multi-key management with improved right-click menu experience
- Improved: Fixed submenu expansion issues in extensions and optimized menu display logic
- Improved: Updated plugin development documentation in both Chinese and English

## Update v0.3.6
- Added: Built-in `xxtui todo push` extension to send todos from your document to xxtui in one click, with follow-up improvements to the todo menu UX and batched push behavior.
- Added: Extension runtime now exposes a right-click menu API, along with a demo extension that showcases multiple menu items, nested submenus, and custom icons.
- Added: Extension marketplace now lets you manually choose the install/update channel (GitHub or official site), with the other side automatically used as a fallback to stay robust under different network conditions.
- Added: Dropdown submenu API for extensions so plugins can build grouped menus and more complex action entries.
- Improved: Reworked the Edit mode padding and width control logic, aligning width tuning behavior between Edit and Reading modes so finding a comfortable reading width feels more natural.
- Fixed: Cleaning up extension-registered menus on uninstall to avoid stale or duplicated menu entries.

## Update v0.3.5
- Added: In Edit mode, pasting a URL with `Ctrl+V` now fetches the page `<title>` and expands it into a `[page title](https://...)` Markdown link, while `Ctrl+Shift+V` always pastes plain text.
- Fixed: When pasting from HTML sources, the editor no longer inserts both raw text and converted Markdown; `Ctrl+V` now only keeps the converted Markdown content.
- Added: In Reading mode, holding `Shift` and scrolling the mouse wheel adjusts the reading width, making long-form reading more comfortable.
- Added: Extension update indicators have been added to the notification area in the main window so you can spot available plugin updates at a glance.
- Improved: The AI assistant extension now supports docking on the right side with drag-to-snap behavior, along with several interaction and UX refinements.

## Update v0.3.4
- Improved: Optimized WebDAV sync strategy with new sync options and more robust handling when documents are deleted, moved, or renamed.
- Added: Custom library icons support, along with refreshed folder/library icon styles.
- Improved: Added an optional grid background for Edit mode and refined sidebar copy/layout to better fit multi-library scenarios.
- Improved: Smoother new-document flow so creating and entering the editor feels more seamless.
- Fixed: Rename dialog not refreshing when switching between Chinese and English, and completed the English version of the context menu.
- Improved: Simplified the hit-count display for Find / Find & Replace to keep focus on the most important numbers.

## Update v0.3.3
- Fixed: Manual WebDAV sync no longer gets skipped when the local tree appears unchanged, avoiding missed remote updates.
- Improved: Switching between Edit / Reading / WYSIWYG modes now preserves the scroll position so toggling modes no longer jumps around.
- Improved: Outline navigation and Find/Replace — added match counters with current/total display and fixed several cases where clicking an outline item or search result would not scroll accurately to the target in Edit or Reading mode.

## Update v0.3.2
- Fixed: PDF outline/bookmarks could become invalid; now exported and viewed PDFs retain correct table-of-contents navigation
- Improved: After WebDAV sync completes, the document library tree is proactively refreshed so you don't need to refresh manually
- Improved: AI assistant plugin sidebar now has a minimum width to avoid layout issues when dragged too narrow

## Update v0.3.1
- Improved: Greatly improved startup and rendering performance
> DOM ready: '16ms', first render: '262ms', app ready: '293ms', total: '293ms'
- Improved: WebDAV sync calculation and comparison logic; added concurrent upload/download/scan to greatly speed up synchronization
- Improved: Sync status is now displayed independently to avoid being interrupted by row/column status
- Added: Word count information has been added to the row/column status

## Update v0.3.0
- Improved Enhance window styles, add animation effects, and theme backgrounds



## Update v0.2.9
- Added Exposed `pickDocFiles`, `openFileByPath`, and `exportCurrentToPdf` interfaces for extensions to enrich their functionalities.
- Improved Added a fallback address to the extension marketplace to provide services for regions with GitHub connectivity issues.
- Improved Added connection status prompts to the extension marketplace.
---
Extension Update
Added Batch PDF Export Extension (Supported in v0.2.9)

## Update v0.2.8
- Added: Update checking and hot-reload support for extension plugins.
- Improved: Rendering logic of the extension marketplace.
- Improved: Removed obsolete dependencies and debug logging to optimize performance and reduce installer/bundle size.

## Update v0.2.7
- Added: Ctrl+H find & replace in WYSIWYG mode.
- Added: Replaced WebView's built-in "Find in page" with a unified JS search panel.
- Fixed: Ctrl+F match counter in Reading/Preview mode reporting double counts.
- Fixed: In Edit mode, cycling backwards in find & replace could lose the inverted selection highlight after wrapping to the first match.
- Fixed: KaTeX square roots sometimes not rendering in the preview layer, in SVG exports, or when saving as PDF.
- Improved: Auto-update download pipeline — added ghfast.top as an extra proxy prefix and tweaked some styles (including sidebar header z-index).
## Update v0.2.6
- Fixed: Missing LaTeX symbols in Reading mode rendering
- Improved: Mermaid is now supported when exporting to Word (DOCX/WPS)

## Update v0.2.5 
- Added: Mermaid zoom support in Reading/WYSIWYG modes
- Added: Export Mermaid as standalone SVG
- Improved: Handle array returns from open dialogs; fixes some macOS cases where files failed to load on open
- Improved: Register native macOS menu events to ensure the system menu also triggers the open flow

## Update v0.2.4
- Added: Editor/Plugin APIs to empower AI extensions (insert at cursor, streaming output, replace selection)
- Added: Plugin store sorting and "Featured" badge styling
- Added: Multiple libraries support
- Fixed: Extension buttons missing after restart due to not being registered on startup

## Update v0.2.3
- Added: Custom font support (Theme panel). Supports picking system fonts and installing user fonts for use in the app.
- Added: Zoom in/out via Ctrl/Cmd + mouse wheel in Edit, Reading and WYSIWYG modes.
- Fixed: Clicking File and Mode menus in succession sometimes failed to open their menu items.
- Fixed: macOS - Documents failed to load after application launch.
- Improved: Unified centered layout between Edit and Reading/WYSIWYG modes.

## Update v0.2.2
- Fixed: Theme-related CSS compatibility to better respect color variables across modes.
- Improved: Global icons/visual polish.



## Update v0.2.0
- Added: Theme and background color customization/extension API
- Added: Image hosting conversion & compression, with on/off switch and quality controls
- Fixed: macOS path escaping issue causing files not to load when opened (app launched but document not loaded)
- Improved: Added background color to Reading mode to visually distinguish it from Edit mode
- Improved: Image hosting uploads switched to WebP format to better suit network usage

## Update v0.1.9
- Added: Drag documents in the library to move between folders
- Added: In Chinese IME, typing two ￥/¥ in a row maps to $$ (edit mode only)
- Improved: Updater now includes changelog
- Improved: After auto-installation fails, provide an option to open the download directory for manual installation fallback

## Update v0.1.8
- Added: Save as PDF
- Added: Save as DOCX and WPS (Mermaid not supported)
- Fixed: Code block language label no longer overlaps code lines
- Improved: Removed unnecessary dependencies
- Improved: Better cache utilization for performance
- Improved: Split chunks to improve performance

## Update v0.1.7
- Improved: Changed mermaid in WYSIWYG mode to global rendering / double-click image to edit code
- Improved: Adjusted default mermaid scaling
- Fixed: Ctrl+Z couldn't undo replace content
- Fixed: * marker completion logic
- Fixed: Text display error in Ctrl+K hyperlink shortcut popup in WYSIWYG mode
- Added: Deletion marker ~~ completion. (Surround completion only works with English IME~)


## Update v0.1.6
- Fixed: Interface incorrectly displaying as edit when switching from Reading → WYSIWYG → back to "Reading" via "Mode" menu
- Fixed: Unsaved prompt when switching modes after only switching to WYSIWYG without editing (initialization/closing WYSIWYG V2 causing false dirty flag)
- Improved: WYSIWYG mode now supports undo/redo (Ctrl+Z / Ctrl+Y)
- Improved: Edit and indent modes support Tab paragraph indentation (simulates input &emsp;&emsp;)
- Optimized: Smooth animation transitions, improved font rendering. Added anti-aliasing and some CSS beautification
- Added: TODO list support, change status by mouse click (Reading mode only)
- Added: New Ctrl+H find & replace in Edit mode, added paired marker completion (auto/surround/skip/paired deletion)
  - Auto-completion: When typing left markers like `(`, `[`, `{`, `"`, `'`, `` ` ``, `*`, `_` in Edit mode, automatically insert right marker and place cursor between them. *May have compatibility issues with some Chinese IMEs*
  - Surround completion: When text is selected and a left marker is typed, automatically add paired markers before and after selected text, only adjusting selection for continued input. *May have compatibility issues with some Chinese IMEs*
  - Skip right: When typing a right marker, if the same marker already exists at cursor position, directly move cursor right to avoid duplication. *May have compatibility issues with some Chinese IMEs*
  - Paired deletion: Backspace between a pair of markers deletes both markers at once. *May have compatibility issues with some Chinese IMEs*

## Update v0.1.5
- Hidden mermaid rendering error prompts in WYSIWYG mode to avoid disrupting input experience
- Set icons for different formats in library/file list for distinction
- Added Markdown table of contents outline (WYSIWYG and Reading modes) and PDF bookmark table of contents
- Fixed issue where unselected library directory was still displayed after not selecting library
- Restored previously hidden scrollbars while maintaining elegant simplicity
- Tab display optimization (priority push, small changes, intuitive benefits)
>  Title displays file name; appends parent directory name for duplicate names; added unsaved indicator*; window title syncs to "filename - FlySpeed MarkDown", easier to distinguish in taskbar/switching; hover title shows full path


## Update v0.1.4
- Sync feature added library root snapshot for quick short-circuit, avoiding meaningless scanning and inability to sync empty directories
- Sync feature added directory snapshots to optimize remote scanning logic, greatly improving scanning speed
- Fixed incorrect rendering of LaTeX formula ² in Reading mode
- Changed LaTeX formulas in WYSIWYG mode to global rendering
- Fixed issue where closing program without saving document didn't prompt for save
- Fixed code block format abnormality in Reading mode
- Fixed Linux icon not displaying issue


## Update v0.1.3
- Refactor: Completely refactored WYSIWYG mode, now WYSIWYG V2 has better experience
> To ensure editing smoothness, LaTeX and Mermaid will display as source code, only rendering when cursor or mouse pointer is in code area. Inline formula $...$ doesn't inline render (for stable editing)
- Fixed: Supplied missing update address for macOS version
- Changed: More flexible (library) sidebar mode
- Changed: Changed single column to multi-level menu
- Added: Save reminder popup when switching documents
- Added: Reading mode shortcut Ctrl+R, WYSIWYG mode shortcut Ctrl+W



## Update v0.1.2
- Modified extension window and some extension styles
- Added sync logic options, enriched real-time log information
- Modified sync scanning logic to improve scanning speed
- Rewrote some sync logic, will ask whether to sync delete or download restore when encountering locally deleted files
- Document library added new/delete folder functionality
- Fixed issue where printing documents could only print visible range


## Update v0.1.1
- Added extension list hot update functionality

## Update v0.1.0-fix
- Temporarily removed deletion judgment in sync functionality, only doing incremental sync
- Greatly optimized hash algorithm in sync functionality
- Added sync log display and log recording
> Those who lost local files using version 0.1.0 sync can use this version to sync and restore. Sync functionality still not perfected, please don't use in production environment, backup data well

## Update v0.1.0
- Added: WebDAV sync extension using sync metadata management, content hash comparison, timestamp auxiliary judgment. **This release has been deleted, this version will cause local file loss**
> Sync functionality is in testing and adjustment stage, must backup data well. If issues arise, please submit ISSUE. First sync will be slower (calculating hash values)


## Update v.0.0.9-fix
- Added: Provide manual open method as fallback after download update startup failure
- Fixed: Unable to focus edit in WYSIWYG mode after uploading image

## Update v.0.0.9
- Added: Always save images to local. Default off
- Added: Convert to markdown format when copying rendered article to editor to ensure format not lost
- Added: Extension functionality, can now manage and install extensions. Author: [HansJack](https://github.com/TGU-HansJack)
- Adjusted: Moved new button to leftmost to conform to operation habits
- Optimized: Greatly optimized document library opening speed

## Update v.0.0.8-fix
- Fixed previous incorrect update link causing automatic download failure
- Added several backup proxy addresses to prevent update failure due to proxy failure


## Update v.0.0.8
- Fixed: Falling back to base64 when pasting images from clipboard without image hosting configured
- Added: When image hosting not configured, pasting clipboard images will write to local images directory
[Locally existing images will be read by path, not written to images directory]
[Pasting images in unsaved documents will go to system default pictures directory, falls back to base64 if fails]
**Default Priority**
  - Image hosting enabled and configured → direct upload and insert public URL (not saved locally)
  - Not enabled/not configured → go to local save branch [created document: same-level images; uncreated document: system pictures directory]
  - If image hosting enabled but upload fails → fall back to local save branch as fallback
  - Locally existing images will be read by path, not written to images directory


## Update v.0.0.7
- Added: Custom sorting for file library
- Added: File library hides files other than md/txt/pdf/markdown
- Added: Update detection and download functionality
- Optimized: Added cache for mermaid icons




## Update v0.0.6-fix
- Fixed: Unable to focus input box when editing to bottom in WYSIWYG mode
- Optimized: WYSIWYG mode scrolling logic
- Known: Text input after mermaid in viewport in WYSIWYG mode will cause interface flicker

## Update v0.0.6
- Added: Automatic memory of reading/editing positions, will automatically return to last exit position when reopening previously edited or read files
- Optimized: Modified WYSIWYG mode logic for handling LaTeX and mermaid, now WYSIWYG mode supports LaTeX and mermaid
- Optimized: Shortened line spacing in code areas and other display effect optimizations

## Update v0.0.6-beta
- Added: WYSIWYG mode (currently doesn't support LaTeX and mermaid, recommend switching back to normal mode when inputting latex and mermaid)


## Update v0.0.5

- Added: PDF preview support
- Added: PDF suffix association
- Optimized: First screen opening speed


## Update v0.0.4

- Added: Document library new/rename/delete/move operations
- Added: Image hosting one-click toggle for easy switching to local mode
- Refactored: Redesigned UI, added library icon
- **Enabled new version number, old version installations need uninstall and reinstall (data not lost)**

## Update v0.0.3

- Added: Library feature, displays all documents in library in sidebar
- Added: Direct clipboard image paste
- Fixed: Local images cannot render issue
- Fixed: Links cannot jump issue


## Update v0.0.2

This version focuses on stability and detail experience optimization, main changes:

- Unified confirmation dialogs to Tauri native `ask` (open/new/drag open/close)
- Fixed: Issue where no prompt when closing without saving
- Fixed: Visual overflow of two input boxes in insert link popup at certain sizes
- Enhanced: Document drag experience
- Enhanced: Preview security/display
- Enhanced: Mermaid rendering process and error prompts; code highlighting lazy loaded


## Update v0.0.1

- Added: LaTeX (based on KaTeX) rendering support
- Added: Mermaid flowchart/sequence diagram etc. rendering support
- Added shortcuts: Ctrl+B bold, Ctrl+I italic, Ctrl+K insert link
