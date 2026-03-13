import { useState, useEffect } from "react"
import { MessageCircle, ArrowUp, Clock, ChevronDown } from "lucide-react"
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
      const comment = await postComment(
        videoId,
        authorName.trim(),
        content.trim()
      )
      setComments((prev) => [...prev, comment])
      setContent("")
      localStorage.setItem("reko-comment-name", authorName.trim())
    } catch {
      // silently fail
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem("reko-comment-name")
    if (saved) setAuthorName(saved)
  }, [])

  const canSubmit = authorName.trim() && content.trim() && !isSubmitting

  return (
    <div className="mt-7">
      <button
        onClick={() => setShowComments((v) => !v)}
        aria-label="Toggle comments"
        className="flex items-center gap-2 p-0 bg-transparent border-none cursor-pointer text-[13px] font-medium text-white/35 hover:text-white/60 transition-colors duration-150"
      >
        <MessageCircle className="w-4 h-4" />
        <span>
          Comments{" "}
          <span className="text-white/20">({comments.length})</span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-white/15 transition-transform duration-200 ease-[var(--ease-out-quint)] ${
            showComments ? "rotate-180" : ""
          }`}
        />
      </button>

      {showComments && (
        <div className="mt-4">
          {/* Comment list */}
          {comments.length > 0 ? (
            <div className="comments-scroll flex flex-col gap-1.5 max-h-[400px] overflow-y-auto mb-4">
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="p-3 rounded-xl bg-white/[0.02] shadow-[0_0_0_0.5px_rgba(255,255,255,0.04)] hover:bg-white/[0.04] transition-colors duration-150"
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="w-[22px] h-[22px] rounded-full bg-white/[0.06] shadow-[0_0_0_0.5px_rgba(255,255,255,0.06)] flex items-center justify-center shrink-0 uppercase select-none text-[10px] font-semibold text-white/35">
                      {comment.authorName.charAt(0)}
                    </div>
                    <span className="text-[13px] font-medium text-white/70">
                      {comment.authorName}
                    </span>
                    <span className="text-[11px] text-white/20">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                    {comment.timestampMs !== null && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-400/60 tabular-nums">
                        <Clock className="w-3 h-3" />
                        {formatTimestamp(comment.timestampMs)}
                      </span>
                    )}
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-white/45 pl-8">
                    {comment.content}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-7 text-[13px] text-white/20 mb-4">
              No comments yet
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="Your name"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              maxLength={50}
              className="w-full h-10 px-3.5 text-[13px] text-white/85 placeholder:text-white/20 bg-white/[0.03] border-none rounded-[10px] outline-none player-input transition-shadow duration-150"
            />
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add a comment&#8230;"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={2000}
                className="flex-1 h-10 px-3.5 text-[13px] text-white/85 placeholder:text-white/20 bg-white/[0.03] border-none rounded-[10px] outline-none player-input transition-shadow duration-150"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    e.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <button
                type="submit"
                disabled={!canSubmit}
                aria-label="Post comment"
                className={`w-10 h-10 flex items-center justify-center shrink-0 border-none rounded-[10px] shadow-[0_0_0_0.5px_rgba(255,255,255,0.05)] transition-[background,color] duration-150 ${
                  canSubmit
                    ? "bg-white/[0.08] text-white/70 cursor-pointer hover:bg-white/12 hover:text-white/90"
                    : "bg-white/[0.03] text-white/12 cursor-not-allowed"
                }`}
              >
                <ArrowUp className="w-4 h-4" />
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
