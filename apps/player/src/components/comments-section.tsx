import { useState, useEffect } from "react"
import { MessageCircle, Send, Clock } from "lucide-react"
import { fetchComments, postComment, type VideoComment } from "@/lib/api"

interface CommentsSectionProps {
  videoId: string
  enabled: boolean
}

export function CommentsSection({ videoId, enabled }: CommentsSectionProps) {
  const [comments, setComments] = useState<VideoComment[]>([])
  const [authorName, setAuthorName] = useState("")
  const [content, setContent] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showComments, setShowComments] = useState(false)

  useEffect(() => {
    if (!enabled) return
    fetchComments(videoId).then(setComments).catch(() => {})
  }, [videoId, enabled])

  if (!enabled) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authorName.trim() || !content.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      const comment = await postComment(videoId, authorName.trim(), content.trim())
      setComments((prev) => [...prev, comment])
      setContent("")
      // Save author name for future comments
      localStorage.setItem("reko-comment-name", authorName.trim())
    } catch {
      // silently fail — non-critical feature
    } finally {
      setIsSubmitting(false)
    }
  }

  // Restore saved name
  useEffect(() => {
    const saved = localStorage.getItem("reko-comment-name")
    if (saved) setAuthorName(saved)
  }, [])

  return (
    <div className="mt-6">
      <button
        onClick={() => setShowComments((v) => !v)}
        aria-label="Toggle comments"
        className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors mb-4"
      >
        <MessageCircle className="w-4 h-4" />
        Comments ({comments.length})
      </button>

      {showComments && (
        <div className="space-y-4">
          {/* Comment list */}
          {comments.length > 0 ? (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="bg-white/5 rounded-lg p-3 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {comment.authorName}
                    </span>
                    <span className="text-xs text-white/40">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                    {comment.timestampMs !== null && (
                      <span className="text-xs text-blue-400 flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        {formatTimestamp(comment.timestampMs)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white/70">{comment.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/40 py-4 text-center">
              No comments yet. Be the first!
            </p>
          )}

          {/* Comment form */}
          <form onSubmit={handleSubmit} className="space-y-2">
            <input
              type="text"
              placeholder="Your name"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/50"
              maxLength={50}
            />
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add a comment..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/50"
                maxLength={2000}
              />
              <button
                type="submit"
                disabled={!authorName.trim() || !content.trim() || isSubmitting}
                aria-label="Post comment"
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-white/10 disabled:text-white/30 rounded-lg text-sm text-white transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(epochMs).toLocaleDateString()
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}
