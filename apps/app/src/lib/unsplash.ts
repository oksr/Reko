// TODO: Move API key to backend proxy before production
const UNSPLASH_ACCESS_KEY = "YQ4bs5vObpt9BrM99cYQAAg05p5WL3xndiL9q-JuBE4"
const BASE_URL = "https://api.unsplash.com"

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

const headers = {
  Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
}

export const UNSPLASH_TOPICS = [
  { slug: "wallpapers", label: "Wallpapers" },
  { slug: "nature", label: "Nature" },
  { slug: "textures-patterns", label: "Textures" },
  { slug: "color-of-water", label: "Abstract" },
  { slug: "architecture-interior", label: "Minimal" },
  { slug: "film", label: "Dark" },
] as const

export async function searchPhotos(
  query: string,
  page = 1,
  perPage = 20,
): Promise<{ photos: UnsplashPhoto[]; totalPages: number }> {
  const params = new URLSearchParams({
    query,
    page: String(page),
    per_page: String(perPage),
    orientation: "landscape",
  })
  const res = await fetch(`${BASE_URL}/search/photos?${params}`, { headers })
  if (!res.ok) throw new Error(`Unsplash search failed: ${res.status}`)
  const data: UnsplashSearchResponse = await res.json()
  return { photos: data.results, totalPages: data.total_pages }
}

export async function getTopicPhotos(
  topicSlug: string,
  page = 1,
  perPage = 20,
): Promise<UnsplashPhoto[]> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
    orientation: "landscape",
  })
  const res = await fetch(`${BASE_URL}/topics/${topicSlug}/photos?${params}`, { headers })
  if (!res.ok) throw new Error(`Unsplash topic fetch failed: ${res.status}`)
  return res.json()
}

export async function trackDownload(downloadLocationUrl: string): Promise<void> {
  await fetch(`${downloadLocationUrl}?client_id=${UNSPLASH_ACCESS_KEY}`)
}
