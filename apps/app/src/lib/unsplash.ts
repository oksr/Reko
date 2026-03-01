export interface UnsplashPhoto {
  id: string
  urls: {
    raw: string
    full: string
    regular: string // ~1080px wide
    small: string // ~400px wide
    thumb: string // ~200px wide
  }
  user: {
    name: string
    links: { html: string }
  }
  links: {
    download_location: string
  }
  width: number
  height: number
  color: string // dominant color hex
}

interface UnsplashSearchResponse {
  total: number
  total_pages: number
  results: UnsplashPhoto[]
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export const UNSPLASH_TOPICS = [
  { slug: "wallpapers", label: "Wallpapers" },
  { slug: "nature", label: "Nature" },
  { slug: "textures-patterns", label: "Textures" },
  { slug: "color-of-water", label: "Abstract" },
  { slug: "architecture-interior", label: "Minimal" },
  { slug: "film", label: "Dark" },
] as const

export async function searchPhotos(
  invoke: InvokeFn,
  query: string,
  page = 1,
  perPage = 20,
): Promise<{ photos: UnsplashPhoto[]; totalPages: number }> {
  const data = await invoke<UnsplashSearchResponse>("unsplash_search_photos", {
    query,
    page,
    perPage,
  })
  return { photos: data.results, totalPages: data.total_pages }
}

export async function getTopicPhotos(
  invoke: InvokeFn,
  topicSlug: string,
  page = 1,
  perPage = 20,
): Promise<UnsplashPhoto[]> {
  return invoke<UnsplashPhoto[]>("unsplash_get_topic_photos", {
    topicSlug,
    page,
    perPage,
  })
}

export async function trackDownload(
  invoke: InvokeFn,
  downloadLocationUrl: string,
): Promise<void> {
  await invoke("unsplash_track_download", { downloadLocationUrl })
}
