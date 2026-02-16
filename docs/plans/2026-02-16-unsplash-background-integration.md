# Unsplash Background Integration

## Summary
Add image backgrounds sourced from Unsplash to the editor's background panel, alongside existing solid and gradient options. Users can search or browse curated categories, select an image, and apply optional blur.

## Data Model

### `BackgroundConfig` (in `src/types/editor.ts`)
Add `"image"` to the type union and new fields:

```ts
export interface BackgroundConfig {
  type: "solid" | "gradient" | "preset" | "image"
  // existing fields unchanged...
  imageUrl: string | null         // local path to downloaded image in project raw/
  imageBlur: number               // 0-20 blur intensity
  unsplashId: string | null       // Unsplash photo ID
  unsplashAuthor: string | null   // photographer name for attribution
}
```

Default values for new fields: `imageUrl: null`, `imageBlur: 0`, `unsplashId: null`, `unsplashAuthor: null`.

## API Integration

### Service: `src/lib/unsplash.ts`
- `searchPhotos(query, page, perPage)` — free-text search
- `getCollectionPhotos(collectionId, page)` — curated categories
- `trackDownload(downloadLocationUrl)` — required by Unsplash API guidelines when a photo is used
- API key hardcoded in constants for now; TODO: proxy through Tauri backend before production

### Curated Categories
Map to Unsplash public collections/topics:
- Nature, Abstract, Dark, Minimal, Colorful, Texture

### Image Flow
1. User browses/searches — thumbnails loaded from Unsplash CDN (~400px)
2. User clicks image — full resolution (~1920px) downloaded via Tauri command
3. Tauri command `download_background_image` fetches URL and saves to `raw/bg-{unsplashId}.jpg`
4. `imageUrl` set to the local file path
5. `trackDownload` called to comply with Unsplash API terms

## Tauri Backend

### New command: `download_background_image`
- Input: `{ projectId, url, filename }`
- Downloads the image to `{project_dir}/raw/{filename}`
- Returns the local file path

## UI Design

### Segmented Control
`Solid | Gradient | Image`

### Image Background Section
```
┌─────────────────────────────┐
│ [Nature] [Abstract] [Dark]  │  ← category chips (horizontal scroll)
│ [Minimal] [Colorful] [Tex]  │
├─────────────────────────────┤
│ 🔍 Search backgrounds...    │  ← debounced search input
├─────────────────────────────┤
│ ┌──────┐ ┌──────┐          │
│ │ img  │ │ img  │          │  ← 2-column grid, paginated
│ └──────┘ └──────┘          │
│ ┌──────┐ ┌──────┐          │
│ │ img  │ │ img  │          │
│ └──────┘ └──────┘          │
├─────────────────────────────┤
│ Blur          ═══●═══  4   │  ← StyledSlider, 0-20
├─────────────────────────────┤
│ Photo by John on Unsplash   │  ← attribution (only when image selected)
└─────────────────────────────┘
```

### Component Structure
```
BackgroundPanel
├── SegmentedControl — "Solid" | "Gradient" | "Image"
├── SolidSection (existing)
├── GradientSection (existing)
└── ImageBackgroundSection (new file)
    ├── CategoryChips
    ├── SearchInput (debounced)
    ├── ImageGrid (2-col, scroll, loading skeletons)
    ├── StyledSlider (blur)
    └── AttributionLine
```

## Implementation Steps

1. **Types & defaults** — Update `BackgroundConfig`, add defaults in editor store
2. **Unsplash service** — Create `src/lib/unsplash.ts` with API helpers
3. **Tauri command** — Add `download_background_image` in Rust
4. **ImageBackgroundSection component** — Build the UI with search, categories, grid, blur
5. **BackgroundPanel integration** — Add "Image" tab, render new section
6. **Preview rendering** — Update canvas/preview to render image backgrounds with blur
7. **Export pipeline** — Ensure Swift export handles image backgrounds
