# FastNote Plugin Development Documentation

[简体中文](plugin.md) | [English](plugin.en.md)

> This document describes how to develop plugins for FastNote

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Plugin Structure](#plugin-structure)
- [Plugin API](#plugin-api)
- [Lifecycle](#lifecycle)
- [Example Plugins](#example-plugins)
- [Publishing Plugins](#publishing-plugins)
- [Theme Extensions](#theme-extensions)

## Overview

flyMD provides a flexible plugin system that allows developers to extend the editor's functionality. Plugins can:

- Add custom menu items
- Access and modify editor content
- Call Tauri backend commands
- Use HTTP client for network requests
- Store plugin-specific configuration data
- Display notifications and confirmation dialogs

### Built-in Extensions

flyMD includes the following built-in extensions:

1. **Image Hosting (S3/R2)** - Upload images to S3/R2 object storage
2. **WebDAV Sync** - Sync documents via WebDAV protocol
3. **Typecho Publisher** - Publish articles to Typecho blog platform (optional)

## Quick Start

### 1. Create Plugin Project

Create a new directory with the following files:

```
my-plugin/
├── manifest.json    # Plugin manifest file
└── main.js          # Plugin main file
```

### 2. Write manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Plugin functionality description",
  // Optional: i18n metadata (recommended)
  "i18n": {
    "zh": {
      "name": "我的插件",
      "description": "插件功能描述"
    }
  },
  "main": "main.js"
}
```

**Field Descriptions:**
- `id` (required): Unique plugin identifier, use lowercase letters and hyphens
- `name` (required): Plugin display name
- `version` (required): Plugin version number, semantic versioning recommended
- `author` (optional): Author information
- `description` (optional): Plugin functionality description
- `main` (required): Plugin entry file, defaults to `main.js`
- `minHostVersion` (optional): Minimum required flyMD version. Installation will be rejected if user's flyMD version is lower, prompting them to upgrade
- `i18n` (optional, recommended): Multi-language metadata organized by language code, e.g.:
  - `i18n.en.name` / `i18n.en.description`: English name and description
  - Current host versions do not rely on this field yet, but future versions may prefer it when rendering the marketplace in different languages. Pre-populating it makes your plugin more future-proof.

### 3. Write main.js

```javascript
// main.js
export function activate(context) {
  // Executed when plugin is activated
  context.ui.notice('My plugin activated!', 'ok', 2000);

  // Add menu item
  context.addMenuItem({
    label: 'My Plugin',
    title: 'Click to execute plugin functionality',
    onClick: async () => {
      const content = context.getEditorValue();
      context.ui.notice('Current content length: ' + content.length, 'ok');
    }
  });
}

export function deactivate() {
  // Executed when plugin is deactivated (optional)
  console.log('Plugin deactivated');
}

export function openSettings(context) {
  // Open plugin settings interface (optional)
  context.ui.notice('Open settings interface', 'ok');
}
```

### 4. Publish to GitHub

1. Create a GitHub repository
2. Push `manifest.json` and `main.js` to the repository
3. Users can install via `username/repo` or `username/repo@branch` format

### 5. Install Plugin

In flyMD:
1. Click the "Extensions" button in the menu bar
2. Enter in the extension installation input box:
   - GitHub repository: `username/repository` or `username/repository@branch`
   - HTTP URL: `https://example.com/path/to/manifest.json`
3. Click the "Install" button

## Plugin Structure

### Basic Structure

```
my-plugin/
├── manifest.json       # Plugin manifest (required)
├── main.js            # Plugin main file (required)
├── README.md          # Documentation (recommended)
└── assets/            # Resource files (optional)
    └── icon.png
```

### manifest.json Details

```json
{
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "author": "Your Name <email@example.com>",
  "description": "This is an example plugin demonstrating flyMD extension development",
  "main": "main.js",
  "minHostVersion": "0.3.0",
  "homepage": "https://github.com/username/example-plugin",
  "repository": "https://github.com/username/example-plugin"
}
```

**Version Compatibility Example:**

If your plugin uses new APIs introduced in flyMD 0.3.5, you can set:

```json
{
  "id": "my-advanced-plugin",
  "name": "Advanced Features Plugin",
  "version": "2.0.0",
  "minHostVersion": "0.3.5",
  "description": "This plugin requires flyMD 0.3.5 or higher"
}
```

When users try to install this plugin on flyMD 0.3.4 or lower, they will receive an error message:
```
This extension requires flyMD 0.3.5 or higher, current version is 0.3.4.
Please upgrade flyMD before installing this extension.
```

## Plugin API

Plugins access flyMD functionality through the `context` object.

### context.http

HTTP client for network requests.

```javascript
// GET request
const response = await context.http.fetch('https://api.example.com/data', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
});
const data = await response.json();

// POST request
const response = await context.http.fetch('https://api.example.com/post', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ key: 'value' })
});
```

### context.getFrontMatterRaw / context.getDocMeta / context.getDocBody

Read YAML Front Matter at the beginning of the current document and its parsed metadata, useful for blog publishing, library enhancements, and external app sync.

> Detection rules:
> - Front Matter is recognized only when the top of the document matches:
>   - First line is `---`
>   - There is at least one line that looks like `key: value` in between
>   - A separate `---` line terminates the block
> - Otherwise these helpers treat the document as plain Markdown and never modify file content

```javascript
// 1. Raw Front Matter text (including --- delimiters), or null when missing
const raw = context.getFrontMatterRaw();
// Example:
// ---
// title: "This is the title"
// keywords: [markdown, hexo]
// ---\n

// 2. Parsed metadata object (using js-yaml); null if missing or parse failed
const meta = context.getDocMeta();
// Typical structure:
// {
//   title: "This is the title",
//   keywords: ["markdown", "hexo"],
//   author: ["Author One", "Author Two"],
//   abstract: "This is the abstract."
// }

// 3. Body part (Markdown without Front Matter)
const body = context.getDocBody();
// - With Front Matter: body starts at the first real content line
// - Without Front Matter: equals context.getEditorValue()
```

**Example: publish using Front Matter title and tags**

```javascript
export function activate(context) {
  context.addMenuItem({
    label: 'Publish to blog',
    async onClick() {
      const meta = context.getDocMeta() || {};
      const body = context.getDocBody();

      const title = meta.title || guessTitleFromBody(body);
      const tags = meta.tags || meta.keywords || [];

      await publishToBlog({
        title,
        tags,
        content: body,
        excerpt: meta.abstract || ''
      });

      context.ui.notice('Published: ' + title, 'ok');
    }
  });
}

function guessTitleFromBody(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return (m && m[1]) || 'Untitled';
}
```

### context.invoke

Call Tauri backend commands.

```javascript
// Call backend command
try {
  const result = await context.invoke('command_name', {
    param1: 'value1',
    param2: 'value2'
  });
  console.log('Command execution result:', result);
} catch (error) {
  console.error('Command execution failed:', error);
}
```

### context.storage

Plugin-specific storage space.

```javascript
// Save data
await context.storage.set('key', { name: 'value', count: 42 });

// Read data
const data = await context.storage.get('key');
console.log(data); // { name: 'value', count: 42 }

// Delete data (set to null)
await context.storage.set('key', null);
```

### context.addMenuItem

Add custom menu items to the menu bar, supporting simple menu items and dropdown menus.

#### Simple Menu Item

```javascript
const removeMenuItem = context.addMenuItem({
  label: 'Menu Text',
  title: 'Mouse hover tooltip',
  onClick: () => {
    // Action on click
    context.ui.notice('Menu clicked!');
  }
});

// Remove menu item (optional)
// removeMenuItem();
```

#### Dropdown Menu

Use the `children` parameter to create dropdown menus:

```javascript
context.addMenuItem({
  label: 'My Tools',
  title: 'Tools menu',
  children: [
    {
      label: 'Option 1',
      onClick: () => {
        context.ui.notice('Option 1 clicked');
      }
    },
    {
      label: 'Option 2',
      onClick: () => {
        context.ui.notice('Option 2 clicked');
      }
    }
  ]
});
```

#### Dropdown Menu with Groups and Dividers

```javascript
context.addMenuItem({
  label: 'To-Do',
  children: [
    // Group title
    {
      type: 'group',
      label: 'Push'
    },
    {
      label: 'All',
      note: 'Completed/Incomplete',  // Right-side note
      onClick: () => pushAll()
    },
    {
      label: 'Completed',
      onClick: () => pushDone()
    },
    {
      label: 'Incomplete',
      onClick: () => pushTodo()
    },
    // Divider
    {
      type: 'divider'
    },
    {
      type: 'group',
      label: 'Reminders'
    },
    {
      label: 'Create Reminder',
      note: '@time',
      onClick: () => createReminder()
    },
    // Disabled state
    {
      label: 'Advanced Features',
      disabled: true,
      note: 'Coming soon'
    }
  ]
});
```

#### Menu Item Configuration

**Regular menu item:**
- `label`: Menu text (required)
- `onClick`: Click callback function (required)
- `note`: Right-side note text (optional)
- `disabled`: Whether disabled (optional, defaults to `false`)

**Group title:**
```javascript
{
  type: 'group',
  label: 'Group Name'
}
```

**Divider:**
```javascript
{
  type: 'divider'
}
```

**Notes:**
- Each plugin can only add one menu item
- If `children` is provided, `onClick` is not needed
- Dropdown menu automatically positions to avoid viewport overflow
- Supports ESC key to close dropdown
- Clicking outside area closes dropdown

### context.addContextMenuItem

Register context menu items in the editor, supporting context awareness and conditional display.

#### Basic Usage

```javascript
// Register a simple context menu item
const removeItem = context.addContextMenuItem({
  label: 'Convert to Uppercase',
  icon: '🔤',
  condition: (ctx) => ctx.selectedText.length > 0,  // Only show when text is selected
  onClick: (ctx) => {
    const upperText = ctx.selectedText.toUpperCase();
    context.replaceRange(
      context.getSelection().start,
      context.getSelection().end,
      upperText
    );
    context.ui.notice('Converted to uppercase', 'ok');
  }
});

// Remove menu item (optional)
// removeItem();
```

#### Context Menu with Submenus

```javascript
context.addContextMenuItem({
  label: 'Text Tools',
  icon: '🛠️',
  children: [
    {
      label: 'To Uppercase',
      onClick: (ctx) => {
        const upper = ctx.selectedText.toUpperCase();
        context.replaceRange(
          context.getSelection().start,
          context.getSelection().end,
          upper
        );
      }
    },
    {
      label: 'To Lowercase',
      onClick: (ctx) => {
        const lower = ctx.selectedText.toLowerCase();
        context.replaceRange(
          context.getSelection().start,
          context.getSelection().end,
          lower
        );
      }
    },
    { type: 'divider' },  // Divider
    {
      label: 'Remove Spaces',
      onClick: (ctx) => {
        const trimmed = ctx.selectedText.replace(/\s+/g, '');
        context.replaceRange(
          context.getSelection().start,
          context.getSelection().end,
          trimmed
        );
      }
    }
  ]
});
```

#### Complete Configuration Example

```javascript
context.addContextMenuItem({
  label: 'Advanced Editing',
  icon: '✨',
  children: [
    // Group title
    {
      type: 'group',
      label: 'Format Conversion'
    },
    {
      label: 'Camel Case',
      note: 'camelCase',
      condition: (ctx) => ctx.selectedText.length > 0,
      onClick: (ctx) => {
        const camelCase = ctx.selectedText
          .replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '');
        context.replaceRange(
          context.getSelection().start,
          context.getSelection().end,
          camelCase
        );
      }
    },
    {
      label: 'Snake Case',
      note: 'snake_case',
      condition: (ctx) => ctx.selectedText.length > 0,
      onClick: (ctx) => {
        const snakeCase = ctx.selectedText
          .replace(/([A-Z])/g, '_$1')
          .replace(/[-\s]+/g, '_')
          .toLowerCase()
          .replace(/^_/, '');
        context.replaceRange(
          context.getSelection().start,
          context.getSelection().end,
          snakeCase
        );
      }
    },
    { type: 'divider' },
    {
      type: 'group',
      label: 'Insert'
    },
    {
      label: 'Insert Timestamp',
      onClick: (ctx) => {
        const timestamp = new Date().toISOString();
        context.insertAtCursor(timestamp);
      }
    },
    // Disabled state
    {
      label: 'AI Polish',
      disabled: true,
      note: 'Coming soon'
    }
  ]
});
```

#### Context Object (ContextMenuContext)

The `condition` and `onClick` callback functions receive a context object:

```javascript
{
  selectedText: string,        // Currently selected text
  cursorPosition: number,      // Cursor position
  mode: 'edit' | 'preview' | 'wysiwyg',  // Current editing mode
  filePath: string | null      // Current file path
}
```

#### Configuration Parameters

**Regular menu item:**
- `label`: Menu text (required)
- `icon`: Icon, supports emoji (optional)
- `onClick`: Click callback function, receives context object (required)
- `condition`: Condition function, shows when returns `true` (optional)
- `note`: Right-side note text (optional)
- `disabled`: Whether disabled (optional, defaults to `false`)

**With submenus:**
- `label`: Menu text (required)
- `icon`: Icon (optional)
- `children`: Array of submenu items (required)

**Group title:**
```javascript
{
  type: 'group',
  label: 'Group Name'
}
```

**Divider:**
```javascript
{
  type: 'divider'
}
```

#### Notes

- Context menu automatically adjusts position based on viewport boundaries to prevent overflow
- Submenu intelligent positioning: automatically detects available space, expands right or left to ensure visibility
- Supports ESC key to close menu
- Clicking outside area closes menu
- `condition` function dynamically controls menu item visibility
- Each extension can register multiple context menu items
- Context menu only overrides browser default menu when extensions are registered
- **Access native context menu**: Hold `Shift` key while right-clicking to show browser native menu
- Submenus support hover expansion, mouse over menu items with arrows to expand submenus
- **Language switching**: flyMD can switch UI language at runtime; built-in menus refresh automatically, but plugin-registered context menu items do not (the `label` text is fixed when you call `addContextMenuItem`). To make your menu text follow language changes immediately, listen for the language change event and re-register menus.

#### Language Switching & Menu Refresh

When the user changes language via the menu, the host dispatches a global event:

```javascript
window.addEventListener('flymd:localeChanged', (ev) => {
  // ev.detail.pref is 'auto' | 'zh' | 'en'
});
```

If your context menu needs to switch language immediately (instead of waiting for an app restart), you can:

1. In `activate`, wrap “register menu” into a helper function;
2. Store the disposer returned by `context.addContextMenuItem`;
3. On `flymd:localeChanged`, remove the old menu and re-register with the new language;
4. Clean up the event listener and menu items in `deactivate` (or your own cleanup hook).

Example (simplified):

```javascript
let disposeMenu = null;

function getLabel(pref) {
  if (pref === 'en') return 'Format Code';
  return '格式化代码';
}

export function activate(context) {
  function registerMenu(pref) {
    if (disposeMenu) { disposeMenu(); disposeMenu = null; }
    disposeMenu = context.addContextMenuItem({
      label: getLabel(pref),
      icon: '🎨',
      condition: (ctx) => ctx.mode === 'edit' && ctx.selectedText.length > 0,
      onClick: (ctx) => { /* ... */ }
    });
  }

  // Read current preference (localStorage: flymd.locale), default to 'auto' when not set
  const pref = localStorage.getItem('flymd.locale') || 'auto';
  registerMenu(pref);

  const onLocaleChanged = (ev) => {
    const nextPref = ev.detail?.pref || 'auto';
    registerMenu(nextPref);
  };

  window.addEventListener('flymd:localeChanged', onLocaleChanged);

  // Simple cleanup: remove listener and menu on deactivate
  context.onDeactivate = () => {
    window.removeEventListener('flymd:localeChanged', onLocaleChanged);
    if (disposeMenu) disposeMenu();
  };
}
```

> Note: `flymd:localeChanged` only fires when the user explicitly changes language from the menu. `detail.pref` is the preference (`auto` / force Chinese / force English); the actual UI language is resolved by the host.

#### Practical Application Example

```javascript
// Code formatting tool
export function activate(context) {
  context.addContextMenuItem({
    label: 'Format Code',
    icon: '🎨',
    condition: (ctx) => {
      // Only show in edit mode when text is selected
      return ctx.mode === 'edit' && ctx.selectedText.length > 0;
    },
    onClick: (ctx) => {
      try {
        // Try to format JSON
        const formatted = JSON.stringify(JSON.parse(ctx.selectedText), null, 2);
        context.replaceRange(
          context.getSelection().start,
          context.getSelection().end,
          formatted
        );
        context.ui.notice('JSON formatted successfully', 'ok');
      } catch {
        context.ui.notice('Formatting failed, please check JSON syntax', 'err');
      }
    }
  });
}
```

### context.ui.notice

Display notification messages.

```javascript
// Show success notification (default)
context.ui.notice('Operation successful!', 'ok', 2000);

// Show error notification
context.ui.notice('Operation failed!', 'err', 3000);

// Parameter descriptions:
// - message: Notification content
// - level: 'ok' or 'err', defaults to 'ok'
// - ms: Display duration (milliseconds), defaults to 1600
```

### context.ui.confirm

Display confirmation dialog.

```javascript
const confirmed = await context.ui.confirm('Are you sure you want to perform this operation?');
if (confirmed) {
  context.ui.notice('User confirmed operation');
} else {
  context.ui.notice('User canceled operation');
}
```

### context.getEditorValue

Get current editor content.

```javascript
const content = context.getEditorValue();
console.log('Current content:', content);
console.log('Character count:', content.length);
```

### context.setEditorValue

Set editor content.

```javascript
// Replace all content
context.setEditorValue('# New Content\n\nThis is new content');

// Append content
const current = context.getEditorValue();
context.setEditorValue(current + '\n\nAppended content');
```

**Note:** Calling this method will:
- Mark document as unsaved
- Update title bar and status bar
- Auto re-render preview if in preview mode

### context.pickDocFiles

Open file selection dialog in desktop version, select one or more Markdown documents (`md / markdown / txt`), return absolute path array.

```javascript
// Select multiple documents
const files = await context.pickDocFiles({ multiple: true });

if (!files || files.length === 0) {
  context.ui.notice('No documents selected', 'err');
} else {
  context.ui.notice('Selected ' + files.length + ' documents', 'ok');
}
```

**Note:**
- Only available in desktop version (Tauri app), browser environment returns empty array with alert.
- Return value is string array, each item is absolute file path.

### context.getCurrentFilePath

Get the absolute path of the current document. Returns `null` if the content has not been saved to disk yet or the runtime does not expose a file path.

```javascript
const path = context.getCurrentFilePath();

if (!path) {
  context.ui.notice('Current document is not saved yet, no path available', 'err');
} else {
  context.ui.notice('Current file path: ' + path, 'ok');
}
```

**Typical usage:**
- Combine with `context.readFileBinary` to read raw bytes of the current PDF/image for upload or parsing;
- Use as the source path when calling `context.createStickyNote` or `context.openFileByPath`.

**Notes:**
- Returns OS-level absolute paths (e.g. `C:/docs/note.md` or `/home/user/note.md`);
- For “new, unsaved” documents this will be `null`.

### context.getLibraryRoot

Get the absolute path of the currently active library root directory. Returns `null` if no library is open.

```javascript
const root = await context.getLibraryRoot();

if (!root) {
  context.ui.notice('No library is currently open', 'err');
} else {
  context.ui.notice('Current library root: ' + root, 'ok');
}
```

**Typical usage:**
- Combine with `context.getCurrentFilePath` to calculate “current file’s folder”;
- Build library-relative paths when exporting or generating helper documents.

### context.watchLibrary

Watch filesystem changes under the current library root (optionally recursive). Returns an `unwatch()` function.

Event object:
- `type`: `'create' | 'modify' | 'remove' | 'access' | 'any' | 'other'`
- `kind`: more detailed kind string from the underlying watcher
- `paths`: absolute paths reported by the watcher
- `relatives`: paths relative to the library root (empty string if not under the library)
- `libraryRoot`: library root absolute path
- `raw`: raw watcher event

```javascript
const unwatch = await context.watchLibrary((ev) => {
  if (ev.type !== 'create') return;
  console.log('New files:', ev.relatives.filter(Boolean));
}, { recursive: true, immediate: true });

// unwatch();
```

### context.watchPaths

Watch specific paths (files or directories). By default, non-absolute paths are resolved relative to the current library root.

```javascript
const unwatch = await context.watchPaths(
  ['Notes/', 'Essays/'],
  (ev) => {
    if (ev.type !== 'create') return;
    console.log(ev.relatives.filter(Boolean));
  },
  { base: 'library', recursive: true, immediate: true }
);
```

### context.readFileBinary

Read local file as binary content by absolute path and return a `Uint8Array`. Useful for PDF parsing, image processing and other binary workflows.

```javascript
const path = context.getCurrentFilePath();
if (!path) {
  context.ui.notice('Current document is not saved yet, cannot read file bytes', 'err');
  return;
}

// Read raw bytes (for example, to upload to a remote API)
const bytes = await context.readFileBinary(path);
context.ui.notice('Read bytes: ' + bytes.length, 'ok');
```

**Notes:**
- Only available in desktop version (Tauri app), relies on underlying filesystem permissions;
- Argument must be an absolute path; passing an empty or invalid path will throw an error;
- Return value is always a `Uint8Array`, convenient for passing to `FormData`, `fetch` and similar APIs.

### context.appendTextFile

Append text to the end of a local file (does not overwrite existing content). Useful for “history logs” (e.g. incremental indexing logs).

```javascript
await context.appendTextFile('C:/tmp/my.log', 'one log line\\n');
```

### context.saveMarkdownToCurrentFolder

Save a piece of Markdown content directly as a file in the library, by default using the folder of the “current document” in the sidebar. If there is no current document, it falls back to the library root. This is useful for automatically generating `.md` files after parsing/translating PDFs.

```javascript
const fileName = 'example.pdf.md';
const content = '# Markdown parsed from PDF...';

try {
  const savedPath = await context.saveMarkdownToCurrentFolder({
    fileName,
    content,
    onConflict: 'renameAuto', // 'overwrite' | 'renameAuto' | 'error'
  });

  context.ui.notice('Saved to: ' + savedPath, 'ok');
} catch (e) {
  context.ui.notice('Save failed: ' + (e?.message || String(e)), 'err');
}
```

**Parameters:**
- `fileName`: target file name (no path), e.g. `document.pdf.md` or `document.translated.md`;
- `content`: Markdown text to write;
- `onConflict` (optional): how to handle name conflicts:
  - `'overwrite'`: overwrite existing file;
  - `'renameAuto'` (default): automatically append `-1`, `-2`, etc. to avoid conflicts;
  - `'error'`: throw if the file already exists.

**Behavior:**
- Prefers the folder of the currently open document as target directory;
- If there is no current file or it is outside the active library, falls back to the library root;
- The implementation ensures the final path stays inside the current library.

### context.saveBinaryToCurrentFolder

Safely save binary data (`Uint8Array / ArrayBuffer / number[]`) into the folder of the current document (or the library root), optionally under a subdirectory, and return both the absolute path and a path suitable for use in the current Markdown document.  
Typical use case: when importing Word/HTML, extract embedded `data:` images into an `images/` subfolder and insert relative paths into Markdown.

```javascript
// Example: decode a data:URL image, write it to images subfolder
const { data, fileName } = dataUrlToBytes(dataUrl, 'example', 1);

const { fullPath, relativePath } = await context.saveBinaryToCurrentFolder({
  fileName,              // e.g. 'example-001.png'
  data,                  // Uint8Array / ArrayBuffer / number[]
  subDir: 'images',      // optional, default is the base folder itself
  onConflict: 'renameAuto', // 'overwrite' | 'renameAuto' | 'error'
});

// Then write a relative reference in the current document:
// ![alt text](/relative/path/from/current/doc)
const md = `![image](${relativePath})`;
```

**Parameters:**
- `fileName`: target file name (no path); invalid path characters will be sanitized;
- `data`: binary payload to write, supports `Uint8Array` / `ArrayBuffer` / `number[]`;
- `subDir` (optional): subdirectory relative to the base folder, e.g. `images` or `assets/images`;
- `onConflict` (optional): how to handle name conflicts:
  - `'overwrite'`: overwrite existing file;
  - `'renameAuto'` (default): append `-1`, `-2`, etc. until no conflict;
  - `'error'`: throw if the target already exists.

**Behavior:**
- Base folder is the directory of the currently open document when possible; otherwise falls back to the library root;
- When `subDir` is specified, the implementation attempts to create it recursively; failures are surfaced via write errors or left to callers to handle;
- The final write path is always constrained to stay inside the current library, never outside;
- Return value:
  - `fullPath`: absolute path of the written file;
  - `relativePath`: path relative to the current document, suitable for Markdown references such as `images/foo.png`.

### context.openFileByPath

Open local document by given absolute path, equivalent to user opening the file in the interface.

```javascript
// Open single document
await context.openFileByPath('C:/docs/note.md');

// Can continue to read content after opening
const content = context.getEditorValue();
context.ui.notice('Opened document, length: ' + content.length, 'ok');
```

**Note:**
- Only supports document types currently supported by flyMD (`md / markdown / txt / pdf`).
- Uses internal app opening process, updates current document path, recent files, and other states.

### context.createStickyNote

Create a sticky note window: open specified file in new instance in sticky note mode, automatically enter focus mode + read mode + close library sidebar, and display sticky note control buttons (lock dragging/window always on top).

```javascript
// Open current document as sticky note
const currentFile = 'C:/notes/todo.md';
await context.createStickyNote(currentFile);
context.ui.notice('Sticky note created', 'ok');

// Or trigger from plugin menu
context.addMenuItem({
  label: 'Quick Notes',
  children: [
    {
      label: 'Create Todo Sticky Note',
      onClick: async () => {
        const todoFile = await context.storage.get('todoFilePath');
        if (todoFile) {
          await context.createStickyNote(todoFile);
        } else {
          context.ui.notice('Please set todo file path first', 'err');
        }
      }
    }
  ]
});
```

**Features:**
- Sticky note window automatically resizes to 400×300 pixels and moves to top-right corner
- Automatically enters focus mode (hides native titlebar)
- Automatically switches to read mode
- Automatically closes library sidebar
- Displays two control buttons (only visible in sticky note mode):
  - **Pin button**: Lock window position (disable dragging)
  - **Top button**: Keep window always on top

**Parameters:**
- `filePath` (string, required): Absolute path of file to open in sticky note mode

**Notes:**
- File must be saved to disk (have absolute path)
- Only supports text file types (`.md`, `.markdown`, `.txt`)
- Sticky note window can still switch back to edit mode, user retains full editing capability
- Sticky note mode doesn't affect main window, both can run simultaneously

**Practical Example: Quick Todo Sticky Notes**

```javascript
export function activate(context) {
  let quickNoteFiles = [];

  context.addMenuItem({
    label: 'Sticky Note Tools',
    children: [
      {
        label: 'Add Quick Sticky Note',
        onClick: async () => {
          const files = await context.pickDocFiles({ multiple: true });
          if (files && files.length > 0) {
            quickNoteFiles = [...quickNoteFiles, ...files];
            await context.storage.set('quickNotes', quickNoteFiles);
            context.ui.notice(`Added ${files.length} sticky notes`, 'ok');
          }
        }
      },
      { type: 'divider' },
      {
        type: 'group',
        label: 'Quick Sticky Notes'
      },
      ...quickNoteFiles.map(file => ({
        label: file.split(/[/\\]/).pop(),
        note: '📌',
        onClick: async () => {
          await context.createStickyNote(file);
        }
      }))
    ]
  });

  // Load saved quick notes list on startup
  context.storage.get('quickNotes').then(saved => {
    if (saved) quickNoteFiles = saved;
  });
}
```

### context.exportCurrentToPdf

Export current document to PDF file, target path specified by plugin.

```javascript
// Export current document to specified path
await context.exportCurrentToPdf('C:/docs/note.pdf');
context.ui.notice('PDF export completed', 'ok');
```

**Note:**
- Only available in desktop version (Tauri app), depends on built-in PDF export capability.
- `target` should be complete file path (including `.pdf` extension), invalid path throws error.
- Plugin doesn't need to handle rendering details, export content matches "Save as PDF" in app.

### context.registerAPI

Register plugin API, allowing other plugins to call it. Use to make current plugin an "infrastructure plugin" providing services to others.

```javascript
export function activate(context) {
  // Register utility functions API
  context.registerAPI('my-utils', {
    // Export utility functions
    formatDate: (date) => {
      return date.toISOString().split('T')[0];
    },

    chunk: (array, size) => {
      const chunks = [];
      for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
      }
      return chunks;
    },

    debounce: (fn, delay) => {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    }
  });

  context.ui.notice('Utility library API registered', 'ok');
}
```

**Parameters:**
- `namespace` (string): API namespace, must be unique. Recommended to use plugin ID or descriptive name
- `api` (any): API object to export, can be function, object, class or any JavaScript value

**Notes:**
- Namespace must be unique, registration fails with console warning if already occupied by another plugin
- Registered APIs are automatically cleaned up when plugin is unloaded
- Recommended to register API in `activate` function to ensure API is available when plugin is enabled

### context.getPluginAPI

Get API registered by other plugins.

```javascript
export function activate(context) {
  // Try to get utility library API
  const utils = context.getPluginAPI('my-utils');

  if (!utils) {
    context.ui.notice('Please install my-utils plugin first', 'err');
    return;
  }

  // Use API provided by other plugin
  const today = utils.formatDate(new Date());
  context.ui.notice('Today is: ' + today, 'ok');

  // Use chunk function
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const chunks = utils.chunk(numbers, 3);
  console.log('Chunked result:', chunks); // [[1,2,3], [4,5,6], [7,8,9]]
}
```

**Parameters:**
- `namespace` (string): API namespace to get

**Return Value:**
- Returns corresponding API object if exists
- Returns `null` if doesn't exist

**Best Practices:**
- Check if API exists before use (whether return value is `null`)
- If depending on other plugins, can specify dependency in `manifest.json`
- Recommended to provide complete documentation for infrastructure plugins

### Plugin Collaboration Example

#### Scenario: Base Utility Library + Data Processing Plugin

**1. Base Utility Library Plugin (lodash-lite)**

```json
// lodash-lite/manifest.json
{
  "id": "lodash-lite",
  "name": "Lodash Utility Library (Lite)",
  "version": "1.0.0",
  "description": "Provide common utility functions for other plugins",
  "main": "main.js"
}
```

```javascript
// lodash-lite/main.js
export function activate(context) {
  // Register utility functions API
  context.registerAPI('lodash', {
    // Array processing
    chunk: (arr, size) => {
      const result = [];
      for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
      }
      return result;
    },

    uniq: (arr) => [...new Set(arr)],

    flatten: (arr) => arr.flat(),

    // Object processing
    pick: (obj, keys) => {
      const result = {};
      keys.forEach(key => {
        if (key in obj) result[key] = obj[key];
      });
      return result;
    },

    // String processing
    capitalize: (str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(),

    camelCase: (str) => {
      return str.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '');
    },

    // Function utilities
    debounce: (fn, delay) => {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    }
  });

  context.ui.notice('Lodash utility library loaded', 'ok', 1500);
}
```

**2. Data Processing Plugin (Using Utility Library)**

```json
// markdown-processor/manifest.json
{
  "id": "markdown-processor",
  "name": "Markdown Batch Processing Tool",
  "version": "1.0.0",
  "description": "Batch process Markdown files (depends on lodash-lite)",
  "main": "main.js"
}
```

```javascript
// markdown-processor/main.js
export function activate(context) {
  // Get utility library API
  const _ = context.getPluginAPI('lodash');

  if (!_) {
    context.ui.notice('Please install lodash-lite plugin first', 'err', 3000);
    return;
  }

  // Add menu item
  context.addMenuItem({
    label: 'Batch Process',
    children: [
      {
        label: 'Extract All Headers',
        onClick: async () => {
          const content = context.getEditorValue();
          const lines = content.split('\n');

          // Extract header lines
          const headers = lines.filter(line => line.trim().startsWith('#'));

          // Deduplicate (using lodash API)
          const uniqueHeaders = _.uniq(headers);

          context.ui.notice(`Found ${uniqueHeaders.length} unique headers`, 'ok');
          console.log('Header list:', uniqueHeaders);
        }
      },
      {
        label: 'Format Links',
        onClick: () => {
          const content = context.getEditorValue();
          const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

          let links = [];
          let match;
          while ((match = linkRegex.exec(content)) !== null) {
            links.push({ text: match[1], url: match[2] });
          }

          // Deduplicate (using lodash API)
          const uniqueLinks = _.uniq(links.map(l => l.url));

          context.ui.notice(`Document contains ${uniqueLinks.length} unique links`, 'ok');
        }
      }
    ]
  });

  context.ui.notice('Markdown batch processing tool loaded', 'ok', 1500);
}
```

**Workflow:**

1. User first installs `lodash-lite` base utility library plugin
2. `lodash-lite` registers utility functions via `registerAPI('lodash', ...)` on activation
3. User installs and enables `markdown-processor` plugin
4. `markdown-processor` gets utility functions via `getPluginAPI('lodash')`
5. If utility library doesn't exist, prompts user to install; otherwise uses utility functions normally

**Advantages:**
- Reuse base functionality, avoid duplicate implementation
- Smaller plugin size, only implement business logic
- Ecosystem building: layered architecture of infrastructure plugins + business plugins

## Theme Extensions

flyMD has a built-in theme system and exposes optional Theme extension APIs for plugins to extend or override "color palettes, typography styles, and Markdown rendering styles".

### Capabilities Overview

- Color palette: Append selectable colors to theme panel (for edit/read/wysiwyg backgrounds)
- Typography: Override CSS for existing typography styles (fonts/sizes/line heights, etc.)
- Markdown style: Override CSS for existing styles (headers, quotes, code blocks, tables, etc.)
- Theme preferences: Read/save/apply current theme settings
- Theme events: Listen to theme changes, link plugin UI

Note: Current version ID lists are fixed sets; registering non-existent IDs will be ignored.

- Typography ID: `default | serif | modern | reading | academic`
- Markdown Style ID: `standard | github | notion | journal | card | docs`

### Global Object & API

Can directly access global object in render process: `window.flymdTheme`

```ts
interface ThemePrefs {
  editBg: string       // Edit background
  readBg: string       // Read background
  wysiwygBg: string    // WYSIWYG background
  typography: 'default' | 'serif' | 'modern' | 'reading' | 'academic'
  mdStyle:   'standard' | 'github' | 'notion' | 'journal' | 'card' | 'docs'
}

// Extension entry points
flymdTheme.registerPalette(label: string, color: string, id?: string): void
flymdTheme.registerTypography(id: ThemePrefs['typography'], label: string, css?: string): void
flymdTheme.registerMdStyle(id: ThemePrefs['mdStyle'], label: string, css?: string): void

// Theme state
flymdTheme.applyThemePrefs(prefs: ThemePrefs): void
flymdTheme.saveThemePrefs(prefs: ThemePrefs): void
flymdTheme.loadThemePrefs(): ThemePrefs

// Theme change events (plugins can listen and link)
window.addEventListener('flymd:theme:changed', (e) => {
  const prefs = (e.detail || {}).prefs
  console.log('Theme changed:', prefs)
})
```

### Usage Example: Add Palette + Adjust Docs Style Code Highlighting

```js
// main.js (plugin)
export function activate(context) {
  // 1) Add two selectable colors to theme panel
  flymdTheme.registerPalette('Lavender', '#ede9fe')
  flymdTheme.registerPalette('Mint Green', '#e8fff4')

  // 2) Append/override CSS for Docs style (only takes effect in md-docs)
  flymdTheme.registerMdStyle('docs', 'Docs', `
    .container.md-docs { --c-key:#1f4eff; --c-str:#0ea5e9; --c-num:#d97706; --c-fn:#7c3aed; --c-com:#94a3b8; }
    @media (prefers-color-scheme: dark) {
      .container.md-docs { --c-key:#93c5fd; --c-str:#67e8f9; --c-num:#fdba74; --c-fn:#c4b5fd; --c-com:#9ca3af; }
    }
  `)

  // 3) Quickly apply a theme preference (example: switch read background to lavender)
  const prefs = flymdTheme.loadThemePrefs()
  prefs.readBg = '#ede9fe'
  flymdTheme.saveThemePrefs(prefs)
  flymdTheme.applyThemePrefs(prefs)

  context.ui.notice('Theme extension loaded', 'ok')
}
```

### Usage Example: Adjust Typography Style (Reading)

```js
export function activate() {
  // Append larger line height for "reading" typography style (won't affect other styles)
  flymdTheme.registerTypography('reading', 'Reading', `
    .container.typo-reading .preview-body,
    .container.typo-reading.wysiwyg-v2 .ProseMirror { line-height: 2.0; font-size: 18px; }
  `)
}
```

### Available CSS Variables (Theme Related)

- Layout base colors
  - `--bg` Edit background (applied to `.container` scope)
  - `--preview-bg` Read background (`.container:not(.wysiwyg):not(.wysiwyg-v2) .preview`)
  - `--wysiwyg-bg` WYSIWYG background (`.container.wysiwyg-v2`)
- Code coloring (highlight tokens)
  - `--code-bg`, `--code-border`, `--code-fg`
  - `--c-key`, `--c-str`, `--c-num`, `--c-fn`, `--c-com`
- Code block decoration
  - `--code-pre-pad-y` Code block base vertical padding (combined with language badge spacing)
  - `--code-lang-gap` Language badge spacing extra height (defined in `.codebox`)

### Notes & Best Practices

- Avoid directly overriding `.codebox pre` `padding-top`, uniformly use `--code-pre-pad-y + --code-lang-gap` for spacing to prevent language badge overlapping first line.
- Typography/MdStyle `id` are currently fixed sets; can pass `css` to refine/override existing styles.
- Using `applyThemePrefs` to modify theme only affects current session; combine with `saveThemePrefs` to persist to next startup.
- Listen to `flymd:theme:changed` event to implement plugin UI and theme linkage updates.

## Lifecycle

### activate(context)

Called when plugin is activated (required).

```javascript
export function activate(context) {
  console.log('Plugin activated');

  // Initialize plugin
  context.addMenuItem({
    label: 'My Feature',
    onClick: async () => {
      // Feature implementation
    }
  });
}
```

### deactivate()

Called when plugin is deactivated (optional).

```javascript
export function deactivate() {
  console.log('Plugin deactivated');
  // Clean up resources
}
```

### openSettings(context)

Open plugin settings interface (optional).

```javascript
export function openSettings(context) {
  // Read config from storage
  const loadConfig = async () => {
    const apiKey = await context.storage.get('apiKey') || '';
    const apiUrl = await context.storage.get('apiUrl') || '';
    return { apiKey, apiUrl };
  };

  // Save config
  const saveConfig = async (config) => {
    await context.storage.set('apiKey', config.apiKey);
    await context.storage.set('apiUrl', config.apiUrl);
    context.ui.notice('Configuration saved', 'ok');
  };

  // Create settings interface (example: using prompt)
  const showSettings = async () => {
    const config = await loadConfig();
    const apiKey = prompt('Enter API Key:', config.apiKey);
    if (apiKey !== null) {
      const apiUrl = prompt('Enter API URL:', config.apiUrl);
      if (apiUrl !== null) {
        await saveConfig({ apiKey, apiUrl });
      }
    }
  };

  showSettings();
}
```

## Example Plugins

### 1. Word Count Plugin

```javascript
// main.js
export function activate(context) {
  context.addMenuItem({
    label: 'Word Count',
    title: 'Count characters, words, and lines in current document',
    onClick: () => {
      const content = context.getEditorValue();
      const chars = content.length;
      const words = content.split(/\s+/).filter(w => w.length > 0).length;
      const lines = content.split('\n').length;

      context.ui.notice(
        `Characters: ${chars} | Words: ${words} | Lines: ${lines}`,
        'ok',
        3000
      );
    }
  });
}
```

```json
// manifest.json
{
  "id": "word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Count characters, words, and lines in Markdown documents",
  "main": "main.js"
}
```

### 2. Text Conversion Plugin

```javascript
// main.js
export function activate(context) {
  context.addMenuItem({
    label: 'Uppercase Conversion',
    title: 'Convert selected text to uppercase',
    onClick: async () => {
      const content = context.getEditorValue();
      const confirmed = await context.ui.confirm('Convert all text to uppercase?');

      if (confirmed) {
        const upperCase = content.toUpperCase();
        context.setEditorValue(upperCase);
        context.ui.notice('Conversion completed!', 'ok');
      }
    }
  });
}
```

### 3. HTTP Request Plugin

```javascript
// main.js
export function activate(context) {
  context.addMenuItem({
    label: 'Get IP',
    title: 'Get current public IP address',
    onClick: async () => {
      try {
        const response = await context.http.fetch('https://api.ipify.org?format=json', {
          method: 'GET'
        });

        const data = await response.json();
        context.ui.notice(`Your IP address is: ${data.ip}`, 'ok', 3000);
      } catch (error) {
        context.ui.notice('Failed to get IP: ' + error.message, 'err', 3000);
      }
    }
  });
}
```

### 4. Configuration Storage Plugin

```javascript
// main.js
export function activate(context) {
  context.addMenuItem({
    label: 'My Tool',
    onClick: async () => {
      // Read config
      const prefix = await context.storage.get('prefix') || '>> ';

      // Use config
      const content = context.getEditorValue();
      const lines = content.split('\n');
      const prefixed = lines.map(line => prefix + line).join('\n');

      context.setEditorValue(prefixed);
      context.ui.notice('Prefix added', 'ok');
    }
  });
}

export function openSettings(context) {
  (async () => {
    const currentPrefix = await context.storage.get('prefix') || '>> ';
    const newPrefix = prompt('Set line prefix:', currentPrefix);

    if (newPrefix !== null) {
      await context.storage.set('prefix', newPrefix);
      context.ui.notice('Settings saved', 'ok');
    }
  })();
}
```

## Publishing Plugins

### Method 1: GitHub Publishing (Recommended)

1. **Create GitHub Repository**

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/username/my-plugin.git
   git push -u origin main
   ```

2. **File Structure**

   Ensure repository root contains:
   - `manifest.json`
   - `main.js`
   - `README.md` (recommended)

3. **Installation Method**

   Users can install via following formats:
   ```
   username/my-plugin
   username/my-plugin@main
   username/my-plugin@develop
   ```

### Method 2: HTTP Publishing

1. **Deploy Files**

   Deploy plugin files to web server:
   ```
   https://example.com/plugins/my-plugin/
   ├── manifest.json
   └── main.js
   ```

2. **Ensure CORS**

   Server needs to allow cross-origin access:
   ```
   Access-Control-Allow-Origin: *
   ```

3. **Installation Method**

   Users install via complete URL:
   ```
   https://example.com/plugins/my-plugin/manifest.json
   ```

## Submit Plugin/Extension to In-App Marketplace

Send plugin/extension address and description to fly@llingfei.com or submit an issue

## Best Practices

### 1. Error Handling

Always use try-catch to handle potential errors:

```javascript
export function activate(context) {
  context.addMenuItem({
    label: 'My Feature',
    onClick: async () => {
      try {
        // Operations that might fail
        const data = await context.http.fetch('https://api.example.com');
        // Process data
      } catch (error) {
        context.ui.notice('Operation failed: ' + error.message, 'err', 3000);
        console.error('Detailed error:', error);
      }
    }
  });
}
```

### 2. User Feedback

Provide timely feedback on operation status:

```javascript
export function activate(context) {
  context.addMenuItem({
    label: 'Upload',
    onClick: async () => {
      context.ui.notice('Uploading...', 'ok', 999999); // Long duration display

      try {
        await uploadFunction();
        context.ui.notice('Upload successful!', 'ok', 2000);
      } catch (error) {
        context.ui.notice('Upload failed', 'err', 3000);
      }
    }
  });
}
```

### 3. Data Validation

Validate data before operations:

```javascript
export function activate(context) {
  context.addMenuItem({
    label: 'Process',
    onClick: async () => {
      const content = context.getEditorValue();

      if (!content || content.trim().length === 0) {
        context.ui.notice('Editor content is empty', 'err');
        return;
      }

      // Continue processing...
    }
  });
}
```

### 4. Configuration Management

Provide reasonable default configurations for plugins:

```javascript
async function getConfig(context) {
  return {
    apiKey: await context.storage.get('apiKey') || '',
    timeout: await context.storage.get('timeout') || 5000,
    enabled: await context.storage.get('enabled') ?? true
  };
}
```

### 5. Compatibility

Consider compatibility across different environments:

```javascript
export function activate(context) {
  // Check if required APIs are available
  if (!context.http) {
    context.ui.notice('HTTP functionality unavailable', 'err');
    return;
  }

  // Continue initialization...
}
```

### 6. Scope and Isolation

Understand plugin variable scope to avoid naming conflicts:

#### Isolated Parts

**Storage Space (Fully Isolated)**

Each plugin's `context.storage` is completely independent and won't conflict with other plugins:

```javascript
// plugin-a
export function activate(context) {
  await context.storage.set('count', 1);  // ✅ Independent storage
}

// plugin-b
export function activate(context) {
  await context.storage.set('count', 2);  // ✅ Independent storage, won't overwrite plugin-a
}
```

**Module-level Variables (Local Scope)**

Variables inside modules are local by default and won't conflict:

```javascript
// plugin-a/main.js
const privateData = { count: 1 };  // ✅ Local variable

export function activate(context) {
  console.log(privateData.count);  // ✅ Can access
}
// Other plugins cannot access privateData
```

#### Potentially Conflicting Parts

**Global Object window (Shared)**

Directly mounting variables on `window` may conflict with other plugins:

```javascript
// ❌ Not recommended: Pollutes global namespace
export function activate(context) {
  window.myData = { count: 1 };  // May conflict with other plugins
}

// ✅ Recommended: Use namespace
export function activate(context) {
  window.__pluginData__ = window.__pluginData__ || {};
  window.__pluginData__['my-plugin-id'] = { count: 1 };
}

// ✅ Best: Prefer module scope or context.storage
const myData = { count: 1 };  // Module variable
// or
await context.storage.set('myData', { count: 1 });  // Persistent storage
```

**DOM Element IDs (Shared)**

Avoid using simple ID names:

```javascript
// ❌ Not recommended: May conflict with other plugins
const panel = document.createElement('div');
panel.id = 'panel';

// ✅ Recommended: Use unique IDs
const panel = document.createElement('div');
panel.id = 'my-plugin-panel-' + Math.random().toString(36).slice(2);
```

#### Best Practices Summary

1. **Prefer `context.storage`** - Persistent storage with automatic isolation
2. **Use module scope** - `const/let` variables are local by default
3. **Avoid global pollution** - Don't mount variables directly on `window`
4. **Use unique IDs** - Add plugin prefix or random string to DOM element IDs
5. **Share via API** - Use `context.registerAPI()` to share functionality safely

```javascript
// ✅ Complete example: Good isolation practices
const pluginState = {
  count: 0,
  data: []
};

export async function activate(context) {
  // Load from persistent storage
  const savedCount = await context.storage.get('count') || 0;
  pluginState.count = savedCount;

  // Create unique DOM element
  const panel = document.createElement('div');
  panel.id = `my-plugin-panel-${Date.now()}`;
  panel.className = 'my-plugin-panel';

  // Register API for other plugins
  context.registerAPI('my-plugin', {
    getCount: () => pluginState.count,
    increment: () => {
      pluginState.count++;
      context.storage.set('count', pluginState.count);
    }
  });
}
```

## FAQ

### Q: How to debug plugins?

A: Use `console.log` to output debug information, press `F12` or `Ctrl+Shift+I` in flyMD to open developer tools to view.

```javascript
export function activate(context) {
  console.log('Plugin activated', context);

  context.addMenuItem({
    label: 'Debug',
    onClick: () => {
      console.log('Current content:', context.getEditorValue());
    }
  });
}
```

### Q: Can plugins access the file system?

A: Yes, through `context.invoke` to call Tauri backend commands to access the file system.

### Q: How to update installed plugins?

A: Currently need to remove old version first, then reinstall new version.

### Q: Are there limits on plugin storage space?

A: No hard limits, but recommended to only store necessary configuration data, avoid storing large amounts of data.

### Q: Can I create multiple menu items?

A: Each plugin can only add one main menu item, but can pop up submenus in the menu item's click event.

## Reference Resources

- [Typecho Publisher Plugin](https://github.com/TGU-HansJack/typecho-publisher-flymd) - Official example plugin
- [flyMD GitHub Repository](https://github.com/flyhunterl/flymd)
- [Tauri Documentation](https://tauri.app/)

## License

This document follows the same license as the project: flyMD Non-Commercial Open Source License Agreement (NC 1.0), see [LICENSE](LICENSE).

---

If you have questions or suggestions, welcome to submit an [Issue](https://github.com/flyhunterl/flymd/issues).
