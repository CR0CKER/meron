import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Attachment } from '../../types'
import { Gallery, type GalleryItem } from './Gallery'
import { HtmlFrame } from './HtmlFrame'
import { LinkHoverPreview } from './LinkHoverPreview'
import { mediaSrc, readerAttachmentImages, readerAttachmentVideos } from './messageHelpers'
import { applyReaderFont, applyReaderLayout, applyReaderTheme, stripTrackingPixels } from './readerHtml'
import { applyRemoteContentPolicy } from './remoteContentCsp'
import { useMessageFrameFont } from './useMessageFrameFont'
import { useReaderTheme } from './useFrameTheme'
import { VideoAttachment } from './VideoAttachment'
import { useTranslation } from '../../lib/i18n'
import { frameMetrics, measureFrameHeight } from './frameHeight'

const readerScrollPositions = new Map<string, number>()

interface HtmlMessageViewProps {
  scrollKey: string
  title: string
  /** Iframe-ready HTML, or undefined for a plain-text message. */
  html?: string
  /** Plain-text body, shown in Plain mode or when no HTML is available. */
  text: string
  /** Attachments snapshotted with the reader tab; used for plain/image-only messages. */
  attachments?: Attachment[]
  viewMode: 'html' | 'plain'
  /** Whether this message's remote content may load right now. The body was
   *  baked with the policy in force when the thread was read, so a reveal or a
   *  withdrawn allowance since then has to be applied to its CSP here. */
  allowRemote?: boolean
}

// Renders a single message either as its original email HTML (in a sandboxed
// iframe) or as the plain-text body. The HTML arrives pre-prepared from the
// backend: `cid:` inline images rewritten to `/media/<key>`, oversized images
// capped to the reader width, and a CSP <meta> that gates remote images. The
// iframe runs with `allow-scripts` (needed for our click listener to fire under
// WebKitGTK), but the backend's `default-src 'none'` CSP blocks all email JS, so
// nothing from the message executes. `allow-same-origin` lets us read the
// document to route link clicks to the system browser and open images in the
// shared gallery lightbox.
export function HtmlMessageView({
  scrollKey,
  title,
  html,
  text,
  attachments,
  viewMode,
  allowRemote = false,
}: HtmlMessageViewProps) {
  const { t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const messageFont = useMessageFrameFont()
  const readerTheme = useReaderTheme()
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([])
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const pendingScrollTop = useRef<number | null>(null)
  const lastRestoredScrollTop = useRef<number | null>(null)
  const positionKey = `${scrollKey}:${viewMode}`
  const attachmentImages = useMemo(
    () => readerAttachmentImages(attachments, viewMode === 'html' ? html : undefined, allowRemote),
    [attachments, html, viewMode, allowRemote],
  )

  const attachmentVideos = useMemo(
    () => readerAttachmentVideos(attachments, viewMode === 'html' ? html : undefined, allowRemote),
    [attachments, html, viewMode, allowRemote],
  )
  const hasAttachments = attachmentImages.length > 0 || attachmentVideos.length > 0
  const [frameHeight, setFrameHeight] = useState(20)
  const videoPlayers = attachmentVideos.length > 0 && (
    <div className="flex flex-col gap-2">
      {attachmentVideos.map((video, index) => (
        <VideoAttachment
          key={`${scrollKey}-${index}`}
          src={mediaSrc(video)}
          externalUrl={video.url ?? mediaSrc(video)}
          externalLabel={t('chat.openExternalPlayer')}
        />
      ))}
    </div>
  )

  const openAttachmentImage = useCallback(
    (index: number) => {
      setGalleryItems(
        attachmentImages.map((attachment) => ({
          src: mediaSrc(attachment),
          filename: attachment.filename,
        })),
      )
      setGalleryIndex(index)
    },
    [attachmentImages],
  )

  const cancelPendingScroll = useCallback(() => {
    pendingScrollTop.current = null
    lastRestoredScrollTop.current = null
  }, [])

  const restorePendingScroll = useCallback(() => {
    const top = pendingScrollTop.current
    const container = textRef.current
    if (top === null || !container) return
    container.scrollTop = top
    lastRestoredScrollTop.current = container.scrollTop
    if (Math.abs(container.scrollTop - top) < 1) pendingScrollTop.current = null
  }, [])

  // Observe the whole content, so late-loading attachment images retry the
  // restore too, even when the iframe's measured height stays the same.
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!hasAttachments || viewMode !== 'html' || !html || !content) return
    const observer = new ResizeObserver(restorePendingScroll)
    observer.observe(content)
    return () => observer.disconnect()
  }, [hasAttachments, html, viewMode, restorePendingScroll])

  const saveScrollPosition = useCallback(() => {
    if (pendingScrollTop.current !== null) return
    if (viewMode === 'plain' || !html || hasAttachments) {
      const container = textRef.current
      if (container) readerScrollPositions.set(positionKey, container.scrollTop)
      return
    }

    const win = iframeRef.current?.contentWindow
    const doc = iframeRef.current?.contentDocument
    const top = win?.scrollY ?? doc?.documentElement.scrollTop ?? doc?.body.scrollTop
    if (typeof top === 'number') {
      readerScrollPositions.set(positionKey, top)
    }
  }, [html, positionKey, viewMode, hasAttachments])

  const handleAttachmentScroll = useCallback(() => {
    const container = textRef.current
    if (!container) return
    if (pendingScrollTop.current !== null) {
      // Programmatic restores may be clamped. Any movement away from their
      // actual result belongs to the user, including scrollbar dragging.
      const lastTop = lastRestoredScrollTop.current
      if (lastTop !== null && Math.abs(container.scrollTop - lastTop) < 1) return
      cancelPendingScroll()
    }
    saveScrollPosition()
  }, [cancelPendingScroll, saveScrollPosition])

  const restoreScrollPosition = useCallback(() => {
    const top = readerScrollPositions.get(positionKey)
    if (top === undefined) return

    if (viewMode === 'plain' || !html || hasAttachments) {
      const container = textRef.current
      if (container) container.scrollTop = top
      return
    }

    iframeRef.current?.contentWindow?.scrollTo(0, top)
  }, [html, positionKey, viewMode, hasAttachments])

  useLayoutEffect(() => {
    return saveScrollPosition
  }, [saveScrollPosition])

  useLayoutEffect(cancelPendingScroll, [positionKey, html, hasAttachments, cancelPendingScroll])

  const sanitizedHtml = useMemo(
    () => (html ? applyRemoteContentPolicy(stripTrackingPixels(html), allowRemote) : html),
    [html, allowRemote],
  )

  useEffect(() => {
    setHoveredLink(null)
  }, [html, viewMode])

  const openImage = useCallback((doc: Document, img: HTMLImageElement, event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!img.currentSrc && !img.src) return
    const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>('img')).filter((el) => {
      if (!el.currentSrc && !el.src) return false
      const w = el.getAttribute('width') || ''
      const h = el.getAttribute('height') || ''
      if ((w === '1' || w === '0') && (h === '1' || h === '0')) return false
      if (el.naturalWidth === 1 || el.naturalHeight === 1) return false
      return true
    })
    setGalleryItems(
      imgs.map((el) => ({
        src: el.currentSrc || el.src,
        filename: el.alt || el.title || 'image',
      })),
    )
    setGalleryIndex(Math.max(0, imgs.indexOf(img)))
  }, [])

  const handleFrameClick = useCallback(
    (event: MouseEvent, doc: Document) => {
      const target = event.target as Element | null
      if (!target || typeof target.closest !== 'function') return false
      const img = target.closest('img') as HTMLImageElement | null
      if (!img || !img.src) return false
      openImage(doc, img, event)
      return true
    },
    [openImage],
  )

  const handleFrameReady = useCallback(
    (doc: Document) => {
      applyReaderLayout(doc, messageFont, readerTheme)
      pendingScrollTop.current = hasAttachments ? (readerScrollPositions.get(positionKey) ?? null) : null
      let observer: ResizeObserver | undefined
      if (hasAttachments) {
        // The reader and its attachments share one scroll container. Measure
        // the body instead of letting the iframe fill the remaining viewport.
        for (const element of [doc.documentElement, doc.body]) {
          element.style.setProperty('height', 'auto', 'important')
          element.style.setProperty('min-height', '0', 'important')
          element.style.setProperty('overflow', 'hidden', 'important')
        }
        let overflowExtent = 0
        const measure = () => {
          const measurement = measureFrameHeight(frameMetrics(doc), overflowExtent)
          overflowExtent = measurement.overflowExtent
          setFrameHeight(measurement.height)
        }
        measure()
        observer = new ResizeObserver(measure)
        observer.observe(doc.documentElement)
        observer.observe(doc.body)
      }
      const frame = requestAnimationFrame(hasAttachments ? restorePendingScroll : restoreScrollPosition)
      return () => {
        cancelAnimationFrame(frame)
        observer?.disconnect()
      }
    },
    [messageFont, readerTheme, restoreScrollPosition, restorePendingScroll, hasAttachments, positionKey],
  )

  // The frame only re-runs `onReady` when its document is replaced, so repaint
  // the live document when the typography or theme settings change under it.
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (doc?.body) applyReaderFont(doc, messageFont)
  }, [messageFont, html, viewMode])

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (doc?.body) applyReaderTheme(doc, readerTheme)
  }, [readerTheme, html, viewMode])

  useLayoutEffect(() => {
    if (viewMode !== 'plain' && html) return
    restoreScrollPosition()
    return saveScrollPosition
  }, [html, restoreScrollPosition, saveScrollPosition, viewMode])

  if (viewMode === 'plain' || !html) {
    return (
      <div ref={textRef} onScroll={saveScrollPosition} className="relative flex-1 overflow-y-auto bg-chat px-6 py-6">
        <div className="mx-auto max-w-[680px] space-y-5">
          {attachmentImages.length > 0 && (
            <AttachmentImageGrid images={attachmentImages} onOpen={openAttachmentImage} />
          )}
          {videoPlayers}
          <div className="whitespace-pre-wrap break-words font-message text-[calc(0.9375rem*var(--me-message-scale))] leading-relaxed text-primary select-text tracking-[0.01em]">
            {text || (attachmentImages.length > 0 || attachmentVideos.length > 0 ? '' : '(no content)')}
          </div>
        </div>
        {galleryIndex !== null && galleryItems[galleryIndex] && (
          <Gallery
            items={galleryItems}
            index={galleryIndex}
            onIndexChange={setGalleryIndex}
            onClose={() => setGalleryIndex(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      style={{ backgroundColor: readerTheme.pageBg }}
      onMouseLeave={() => setHoveredLink(null)}
    >
      <div
        ref={textRef}
        className={`flex min-h-0 flex-1 flex-col ${hasAttachments ? 'overflow-y-auto' : ''}`}
        onScroll={hasAttachments ? handleAttachmentScroll : undefined}
      >
        <div ref={contentRef} className={`flex min-h-0 flex-col ${hasAttachments ? 'shrink-0' : 'flex-1'}`}>
          <HtmlFrame
            key={hasAttachments ? 'with-attachments' : 'body-only'}
            ref={iframeRef}
            html={sanitizedHtml ?? ''}
            title={title}
            className={`${hasAttachments ? 'shrink-0' : 'flex-1'} w-full border-0`}
            style={{ backgroundColor: readerTheme.pageBg, ...(hasAttachments ? { height: frameHeight } : {}) }}
            scrolling={hasAttachments ? 'no' : 'auto'}
            onFrameClick={handleFrameClick}
            onReady={handleFrameReady}
            onLinkHover={setHoveredLink}
            onScroll={saveScrollPosition}
          />
          {hasAttachments && (
            <div className="shrink-0 px-6 pb-6">
              <div className="mx-auto max-w-[680px] space-y-5">
                {attachmentImages.length > 0 && (
                  <AttachmentImageGrid images={attachmentImages} onOpen={openAttachmentImage} />
                )}
                {videoPlayers}
              </div>
            </div>
          )}
        </div>
      </div>
      <LinkHoverPreview url={hoveredLink} />
      {galleryIndex !== null && galleryItems[galleryIndex] && (
        <Gallery
          items={galleryItems}
          index={galleryIndex}
          onIndexChange={setGalleryIndex}
          onClose={() => setGalleryIndex(null)}
        />
      )}
    </div>
  )
}

function AttachmentImageGrid({ images, onOpen }: { images: Attachment[]; onOpen: (index: number) => void }) {
  const count = images.length
  const gridClass = count === 1 ? 'grid-cols-1' : count === 2 ? 'grid-cols-2' : 'grid-cols-3'
  const imageClass = count === 1 ? 'max-h-[60vh]' : 'h-44'

  return (
    <div className={`grid ${gridClass} gap-2`}>
      {images.map((image, index) => (
        <button
          key={`${image.filename}-${index}`}
          type="button"
          onClick={() => onOpen(index)}
          title={image.filename}
          className="overflow-hidden rounded-lg border border-border bg-black/[0.03] cursor-zoom-in"
        >
          <img src={mediaSrc(image)} alt={image.filename} className={`w-full object-contain ${imageClass}`} />
        </button>
      ))}
    </div>
  )
}
