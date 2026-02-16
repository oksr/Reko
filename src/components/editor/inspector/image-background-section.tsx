import { useState, useCallback, useRef, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useEditorStore } from "@/stores/editor-store"
import {
  searchPhotos,
  getTopicPhotos,
  trackDownload,
  UNSPLASH_TOPICS,
  type UnsplashPhoto,
} from "@/lib/unsplash"
import { StyledSlider } from "./styled-slider"

export function ImageBackgroundSection() {
  const background = useEditorStore((s) => s.project?.effects.background)
  const projectId = useEditorStore((s) => s.project?.id)
  const setBackground = useEditorStore((s) => s.setBackground)

  const [photos, setPhotos] = useState<UnsplashPhoto[]>([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [activeTopic, setActiveTopic] = useState<string | null>("wallpapers")
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Load initial topic photos
  useEffect(() => {
    if (!activeTopic || query) return
    let cancelled = false
    getTopicPhotos(activeTopic, 1, 9).then((results) => {
      if (cancelled) return
      setPhotos(results)
      setHasMore(results.length === 9)
      setPage(1)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    setLoading(true)
    return () => { cancelled = true }
  }, [activeTopic, query])

  const loadTopicPhotos = async (slug: string, p: number, reset: boolean) => {
    setLoading(true)
    try {
      const results = await getTopicPhotos(slug, p, 9)
      setPhotos(reset ? results : (prev) => [...prev, ...results])
      setHasMore(results.length === 9)
      setPage(p)
    } catch (e) {
      console.error("Failed to load topic photos:", e)
    } finally {
      setLoading(false)
    }
  }

  const loadSearchResults = async (q: string, p: number, reset: boolean) => {
    if (!q.trim()) return
    setLoading(true)
    try {
      const { photos: results, totalPages } = await searchPhotos(q, p, 9)
      setPhotos(reset ? results : (prev) => [...prev, ...results])
      setHasMore(p < totalPages)
      setPage(p)
    } catch (e) {
      console.error("Failed to search photos:", e)
    } finally {
      setLoading(false)
    }
  }

  const handleSearchChange = useCallback(
    (value: string) => {
      setQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!value.trim()) {
        setActiveTopic("wallpapers")
        return
      }
      setActiveTopic(null)
      debounceRef.current = setTimeout(() => {
        loadSearchResults(value, 1, true)
      }, 400)
    },
    [],
  )

  const handleTopicClick = (slug: string) => {
    setQuery("")
    setActiveTopic(slug)
  }

  const handleLoadMore = () => {
    const nextPage = page + 1
    if (query) {
      loadSearchResults(query, nextPage, false)
    } else if (activeTopic) {
      loadTopicPhotos(activeTopic, nextPage, false)
    }
  }

  const handleSelectPhoto = async (photo: UnsplashPhoto) => {
    if (!projectId || downloading) return
    setDownloading(photo.id)
    try {
      // Download full-res image to project
      const filename = `bg-${photo.id}.jpg`
      const localPath = await invoke<string>("download_background_image", {
        projectId,
        url: photo.urls.regular,
        filename,
      })

      // Track download per Unsplash API guidelines
      trackDownload(photo.links.download_location).catch(() => {})

      setBackground({
        type: "image",
        imageUrl: localPath,
        unsplashId: photo.id,
        unsplashAuthor: photo.user.name,
      })
    } catch (e) {
      console.error("Failed to download image:", e)
    } finally {
      setDownloading(null)
    }
  }

  if (!background) return null

  return (
    <div className="space-y-3">
      {/* Category chips */}
      <div className="flex gap-1.5 flex-wrap">
        {UNSPLASH_TOPICS.map((topic) => (
          <button
            key={topic.slug}
            className={`text-[11px] px-2.5 py-1 rounded-full transition-all duration-150 ${
              activeTopic === topic.slug
                ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30"
                : "bg-white/[0.06] text-muted-foreground hover:bg-white/[0.1] hover:text-foreground"
            }`}
            onClick={() => handleTopicClick(topic.slug)}
          >
            {topic.label}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search backgrounds..."
          value={query}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-white/[0.08] bg-white/[0.04] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
        />
      </div>

      {/* Image grid */}
      <div ref={gridRef} className="max-h-[235px] overflow-y-auto p-1 -m-1">
        <div className="grid grid-cols-3 gap-2">
        {photos.map((photo) => (
          <button
            key={photo.id}
            className={`relative aspect-video rounded-md overflow-hidden transition-all duration-150 ${
              background.unsplashId === photo.id
                ? "ring-2 ring-violet-400 ring-offset-1 ring-offset-background scale-[1.02]"
                : "hover:scale-[1.03] hover:ring-1 hover:ring-white/20"
            }`}
            style={{ backgroundColor: photo.color }}
            onClick={() => handleSelectPhoto(photo)}
            disabled={downloading !== null}
          >
            <img
              src={photo.urls.small}
              alt={`Photo by ${photo.user.name}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {downloading === photo.id && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </button>
        ))}

        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={`skeleton-${i}`}
              className="aspect-video rounded-md bg-white/[0.06] animate-pulse"
            />
          ))}
        </div>
      </div>

      {/* Load more */}
      {hasMore && photos.length > 0 && !loading && (
        <button
          onClick={handleLoadMore}
          className="w-full text-[11px] text-muted-foreground hover:text-foreground py-1.5 transition-colors"
        >
          Load more
        </button>
      )}

      {/* Blur slider */}
      {background.imageUrl && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-muted-foreground">Blur</label>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {background.imageBlur}px
            </span>
          </div>
          <StyledSlider
            min={0}
            max={20}
            value={background.imageBlur}
            onChange={(v) => setBackground({ imageBlur: v })}
            showReset={background.imageBlur !== 0}
            onReset={() => setBackground({ imageBlur: 0 })}
          />
        </div>
      )}

      {/* Attribution */}
      {background.unsplashAuthor && (
        <p className="text-[10px] text-muted-foreground/60">
          Photo by {background.unsplashAuthor} on{" "}
          <a
            href="https://unsplash.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-muted-foreground"
          >
            Unsplash
          </a>
        </p>
      )}
    </div>
  )
}
