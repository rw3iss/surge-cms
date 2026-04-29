# Hero Carousel Implementation Plan

## Overview

Add a customizable homepage hero carousel system to the RW CMS admin, with a reusable carousel component for both admin preview and public homepage rendering. This includes new reusable components (MediaSelectModal, MediaUploadModal, ColorPicker, HeroCarousel), admin settings UI for managing hero items, and integration into the live homepage.

---

## Data Model

### Hero Content Settings (stored as JSON in `site_settings` table, key: `homepage_hero`)

```typescript
interface HeroCarouselSettings {
  items: HeroItem[];
  options: HeroCarouselOptions;
}

interface HeroItem {
  id: string;                    // unique ID per item (nanoid or uuid)
  mediaId: string;               // reference to media library item
  mediaUrl: string;              // cached URL for rendering
  mediaThumbnailUrl?: string;    // thumbnail for admin preview
  mediaType: 'image' | 'video';  // derived from media item
  objectFit: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';  // CSS object-fit
  autoplay?: boolean;            // only for video items
  header?: {
    text: string;
    size: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    color: string;               // hex color, default '#ffffff'
  };
  subheader?: {
    text: string;
    size: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    color: string;               // hex color, default '#ffffff'
  };
  action?: {
    label: string;
    url: string;
    openInNewTab: boolean;
  };
  order: number;                  // position in carousel
}

interface HeroCarouselOptions {
  autoScroll: boolean;            // default false
  autoScrollInterval: number;     // ms, default 3000
  repeat: boolean;                // default true (loop back)
  customHeight: boolean;          // default false
  height: string;                 // e.g. '50vh', '600px', default '50vh'
}
```

### Backend Storage
- Key: `homepage_hero` in `site_settings` table
- Value: JSON blob of `HeroCarouselSettings`
- Cached in Redis as `settings:homepage_hero` with 600s TTL
- Invalidated on save via `cache.invalidateSettingsCache()`

---

## New Components to Create

### 1. MediaSelectModal (`frontend/src/components/admin/MediaSelectModal.tsx`)
**Reusable modal for selecting existing media items from the library.**

Props:
```typescript
interface MediaSelectModalProps {
  types?: string[];           // e.g. ['image', 'video'] — if omitted, show all
  onSelect: (media: MediaItem) => void;
  onClose: () => void;
}
```

Features:
- Search input (300ms debounced auto-search) filtering by title/description
- Sort dropdown: date updated (default), date added, name, size, type
- Paginated results (10 per page, configurable constant `ITEMS_PER_PAGE`)
- Grid of media previews: images show thumbnail, videos show thumbnail with play overlay
- Clicking play on a video loads and plays it inline
- Each item shows: preview, name (linked to media detail), date updated, "Select" button
- Backend query: `GET /api/v1/media?types=image,video&search=query&sort=date_desc&page=1&limit=10`

Backend change needed:
- Update `GET /media` endpoint to support `types` query param (comma-separated list of types)
- Currently only supports single `type` param

### 2. MediaUploadModal (`frontend/src/components/admin/MediaUploadModal.tsx`)
**Reusable modal for uploading new media with title/description.**

Props:
```typescript
interface MediaUploadModalProps {
  onUploaded: (media: MediaItem) => void;
  onClose: () => void;
  acceptTypes?: string;       // e.g. 'image/*,video/*' for file input accept
}
```

Features:
- Custom styled "Select File" button (hides native input)
- After file selection: centered preview (image or playable video), file details (name, size, type)
- Title input (full width) and Description textarea (2 lines, full width)
- Cancel / Upload buttons at bottom
- During upload: buttons greyed out, "Uploading, please wait..." with spinner
- On success: "Media uploaded!" message, auto-close, return media item via callback
- Calls `POST /api/v1/media` with file + title + description via FormData

### 3. ColorPicker (`frontend/src/components/admin/ColorPicker.tsx`)
**Lightweight color picker with swatch button and optional hex input.**

Props:
```typescript
interface ColorPickerProps {
  value: string;              // current hex value
  onChange: (hex: string) => void;
  showHexInput?: boolean;     // default true
  defaultColor?: string;      // default '#ffffff'
}
```

Features:
- Swatch button showing current color as background
- Click opens a lightweight picker popup (hue slider + saturation/brightness area, or a simple preset grid + custom hex)
- Hex input to left of swatch (optional via prop)
- Red border on hex input if invalid hex format
- Validates hex on change, falls back to defaultColor on invalid
- Closes picker on outside click
- Implementation: Build a simple custom picker with a hue bar + saturation panel, or use a preset color grid with manual hex entry. Keep it lightweight — no external library.

### 4. HeroCarousel (`frontend/src/components/HeroCarousel.tsx`)
**Universal carousel component used in both admin preview and live homepage.**

Props:
```typescript
interface HeroCarouselProps {
  items: HeroItem[];
  options: HeroCarouselOptions;
  height?: string;            // override height (for preview scaling)
  previewMode?: boolean;      // if true, scale text relative to component width
}
```

Features:
- Renders items in a horizontally sliding carousel
- Single item: just renders it, no arrows
- Multiple items: left/right arrow buttons, optional auto-scroll with interval
- Auto-scroll pauses on hover, resumes on mouse leave
- Repeat/loop: seamless wrap (clone first/last items for infinite scroll effect)
- Touch/swipe support for mobile
- Each item renders:
  - Background layer: image (`<img>` with object-fit) or video (`<video>` with object-fit)
  - Video autoplay: plays when item is active, pauses when not
  - Text overlay layer (centered vertically and horizontally):
    - Header (configured h1-h6 tag, configured color, responsive sizing)
    - Subheader (configured h1-h6 tag, configured color, responsive sizing)
    - Action button (styled CTA, links to configured URL, optional new tab)
  - Text has side padding, scales with container width (use `clamp()` for font sizes)
- Preview mode: scales height and text relative to component width vs window width
- CSS: `frontend/src/components/HeroCarousel.scss`

### 5. HeroContentEditor (`frontend/src/components/admin/HeroContentEditor.tsx`)
**Admin editor for managing hero carousel items and options.**

This is the main editor component embedded in the Settings page "Home Page" section. It manages:

State:
```typescript
const [items, setItems] = createSignal<HeroItem[]>([]);
const [options, setOptions] = createSignal<HeroCarouselOptions>(defaults);
const [isDirty, setIsDirty] = createSignal(false);
```

Layout (top to bottom):
1. **Header bar**: "Hero Content" title + Save button (top right, enabled when dirty)
2. **Horizontal scrollable item list**: Cards ~25% width (4 visible), scrollable
   - Each card shows:
     - Media preview (image or playable video) at top
     - Object-fit dropdown (cover/contain/fill/none/scale-down)
     - Video autoplay toggle (only if video)
     - Add/Edit Header section (toggle button → textarea + size dropdown + color picker + remove)
     - Add/Edit Subheader section (same pattern as header)
     - Add/Edit Action section (toggle button → label input + URL input + new tab toggle + remove)
     - Drag handle for reordering
     - Delete button (with confirm)
   - "Add New Item" card at end with two buttons: "Select Existing Media" / "Upload New Media"
   - Items are drag-reorderable horizontally

3. **Global carousel options** (below item list):
   - Auto-scroll toggle (disabled if 0-1 items)
     - When enabled: interval input (ms, default 3000) to the right
   - Repeat toggle (disabled if 0-1 items)
   - Custom height toggle
     - When enabled: height input with validation (format: `<number>px|vw|vh|%`)
     - Default: '50vh', red border on invalid

4. **Live preview** (below options):
   - "Preview" header, or message if no items
   - Renders `<HeroCarousel>` with current items/options
   - Height scaled relative to preview container width vs window width
   - Updates reactively as items/options change (no save needed)

Unsaved changes: uses `beforeunload` + prompt on navigation (integrate with existing `useUnsavedChanges` hook or inline).

---

## Implementation Steps (ordered)

### Step 1: Backend — Extend media endpoint for multi-type filtering
**File:** `backend/src/routes/media.ts`

- Add support for `types` query param (comma-separated): `?types=image,video`
- When `types` is provided, build `WHERE mime_type LIKE ANY(ARRAY[$1, $2, ...])` clause
- Keep backward compatibility with existing single `type` param
- Add `date_updated_asc` and `date_updated_desc` sort options (currently only `date_asc`/`date_desc` which sort by `created_at` — add `updated_at` variants or alias)

### Step 2: Backend — Homepage hero settings endpoints
**File:** `backend/src/routes/settings.ts`

- Add `GET /homepage-hero` (public, cached) — returns the `homepage_hero` setting value
- Add `PUT /homepage-hero` (admin) — saves the hero config JSON, invalidates cache
- Cache key: `settings:homepage_hero`, TTL: 600s

### Step 3: ColorPicker component
**Files:** `frontend/src/components/admin/ColorPicker.tsx`, `ColorPicker.scss`

Build first since it's a dependency of the hero item editor.
- Simple preset grid (16-20 common colors) + custom hex input
- Hue slider optional (nice-to-have, presets + hex may suffice for v1)
- Swatch button, popup positioning, outside-click-close

### Step 4: MediaSelectModal component
**Files:** `frontend/src/components/admin/MediaSelectModal.tsx`, `MediaSelectModal.scss`

- Overlay + centered modal (similar pattern to existing MediaPickerModal but enhanced)
- Toolbar: search input (debounced 300ms) + sort dropdown
- Paginated grid (10/page) with page nav buttons
- Image thumbnails, video thumbnails with play overlay
- Click play on video → load and play inline
- Select button per item, fires `onSelect` callback

### Step 5: MediaUploadModal component
**Files:** `frontend/src/components/admin/MediaUploadModal.tsx`, `MediaUploadModal.scss`

- Custom file select button
- Preview area (image or video player)
- Title input + description textarea
- Upload progress state
- Calls `api.upload('/media', file, 'file', { title, alt: description })`
- Returns created media item via callback

### Step 6: HeroCarousel component
**Files:** `frontend/src/components/HeroCarousel.tsx`, `HeroCarousel.scss`

- Build the universal carousel renderer
- Test with static data first
- Handle: single item (no arrows), multiple items (arrows + dots), auto-scroll, repeat/loop
- Touch swipe support (pointer events)
- Video autoplay/pause lifecycle
- Responsive text scaling with `clamp()`
- Preview mode scaling logic

### Step 7: HeroContentEditor component
**Files:** `frontend/src/components/admin/HeroContentEditor.tsx`, `HeroContentEditor.scss`

- Horizontal scrollable card list with drag-reorder
- Each card: media preview, object-fit dropdown, header/subheader/action sections
- "Add New Item" card with MediaSelectModal / MediaUploadModal integration
- Global options section (auto-scroll, repeat, custom height)
- Live preview via `<HeroCarousel previewMode={true}>`
- Save button → compile JSON → `PUT /api/v1/settings/homepage-hero`
- Dirty state tracking

### Step 8: Integrate into Admin Settings page
**File:** `frontend/src/pages/admin/Settings.tsx`

- Add new `CollapsibleSection` titled "Home Page" between General and Connections
- Render `<HeroContentEditor />` inside it
- Load initial data from `GET /api/v1/settings/homepage-hero`

### Step 9: Integrate into live Homepage
**File:** `frontend/src/pages/Home.tsx`

- Fetch hero settings from `GET /api/v1/settings/homepage-hero` (or via existing settings fetch)
- Render `<HeroCarousel>` at the top, before existing block content
- Full width, height from settings (default '50vh')
- Show only if hero items exist

### Step 10: Polish and edge cases
- Empty state messaging in admin
- Validation (hex colors, height format, required fields)
- Loading states for media modals
- Mobile responsive: admin cards stack or scroll, carousel touch support
- Cache invalidation on save
- Error handling for failed uploads/saves

---

## File Summary

### New files to create:
| File | Description |
|------|-------------|
| `frontend/src/components/admin/ColorPicker.tsx` | Color picker with swatch + hex input |
| `frontend/src/components/admin/ColorPicker.scss` | Styles for color picker |
| `frontend/src/components/admin/MediaSelectModal.tsx` | Reusable media browser/selector modal |
| `frontend/src/components/admin/MediaSelectModal.scss` | Styles for media select modal |
| `frontend/src/components/admin/MediaUploadModal.tsx` | Reusable media upload modal |
| `frontend/src/components/admin/MediaUploadModal.scss` | Styles for upload modal |
| `frontend/src/components/admin/HeroContentEditor.tsx` | Admin hero carousel editor |
| `frontend/src/components/admin/HeroContentEditor.scss` | Styles for hero editor |
| `frontend/src/components/HeroCarousel.tsx` | Universal carousel renderer |
| `frontend/src/components/HeroCarousel.scss` | Styles for carousel |
| `shared/src/types/hero.ts` | TypeScript interfaces for hero data |

### Files to modify:
| File | Change |
|------|--------|
| `backend/src/routes/media.ts` | Add multi-type filtering (`types` param) |
| `backend/src/routes/settings.ts` | Add `GET/PUT /homepage-hero` endpoints |
| `frontend/src/pages/admin/Settings.tsx` | Add "Home Page" collapsible section with HeroContentEditor |
| `frontend/src/pages/Home.tsx` | Integrate HeroCarousel at top of homepage |
| `frontend/src/services/api.ts` | Add `fetchHeroSettings()` helper |
| `shared/src/types/index.ts` | Export hero types |

---

## Key Design Decisions

1. **Custom carousel vs library**: Build custom. SolidJS has limited carousel library support, and our requirements (video backgrounds, text overlays, preview scaling) are specific enough that a custom solution is cleaner.

2. **Preview scaling**: Calculate `previewWidth / windowWidth` ratio, multiply configured height by that ratio. Text uses `clamp()` with container-relative units.

3. **Settings storage**: Single JSON blob in `site_settings` table. Simple, no new tables needed. Cached in Redis.

4. **Media modals as separate components**: MediaSelectModal and MediaUploadModal are fully isolated and reusable. They communicate via callbacks only. No global state coupling.

5. **Color picker**: Custom lightweight implementation (preset grid + hex input). Avoids external dependency for a simple color selection need.

6. **Drag reorder in horizontal list**: Use pointer events (same pattern as existing block drag-and-drop in BlockEditor), adapted for horizontal scrolling.

7. **Video autoplay**: Uses Intersection Observer to detect when carousel item is active. Autoplay videos play when visible, pause when not. Muted by default (required by browsers for autoplay).
