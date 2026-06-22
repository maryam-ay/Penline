import { useState, useRef } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const TIMEOUT_MS = 15_000

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

// Loads JSZip from CDN on first call; subsequent calls reuse window.JSZip
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = () => resolve(window.JSZip)
    s.onerror = () => reject(new Error('Failed to load JSZip'))
    document.head.appendChild(s)
  })
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="10" stroke="#D6D3CC" strokeWidth="1" />
      <path
        d="M11 15V9M8 12l3-3 3 3"
        stroke="#6B6860"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── job shape: { id, fileName, originalSize, status, svg, svgSize, deltaStr, error }
// status: 'pending' | 'converting' | 'done' | 'failed'

export default function App() {
  const [jobs, setJobsState] = useState([])
  const [activeResult, setActiveResult] = useState(null)
  const [message, setMessage] = useState(null) // { type: 'error'|'info', text }
  const [isDragging, setIsDragging] = useState(false)

  const jobsRef = useRef([])       // always-current mirror of jobs state
  const filesMap = useRef(new Map()) // id → File, cleared after processing
  const isProcessing = useRef(false)
  const fileInputRef = useRef(null)

  // Sync both the React state and the ref so async loops can read the latest queue
  function updateJobs(updater) {
    setJobsState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      jobsRef.current = next
      return next
    })
  }

  async function processJob(job) {
    updateJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'converting' } : j))

    const file = filesMap.current.get(job.id)
    if (!file) return // was cleared while waiting

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`${API_URL}/convert`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Conversion failed.')
      }

      const data = await res.json()
      const svgSize = new Blob([data.svg]).size
      const delta = Math.round((1 - svgSize / job.originalSize) * 100)
      const deltaStr = delta > 0 ? `−${delta}%` : `+${Math.abs(delta)}%`

      updateJobs(prev => prev.map(j =>
        j.id === job.id ? { ...j, status: 'done', svg: data.svg, svgSize, deltaStr } : j
      ))

      setActiveResult({
        svg: data.svg,
        fileName: job.fileName,
        original: formatBytes(job.originalSize),
        svgFormatted: formatBytes(svgSize),
        deltaStr,
      })
    } catch (err) {
      clearTimeout(timer)
      const text = err.name === 'AbortError'
        ? 'Server is warming up. Try again in a moment.'
        : (err.message || 'Conversion failed.')

      updateJobs(prev => prev.map(j =>
        j.id === job.id ? { ...j, status: 'failed', error: text } : j
      ))
      setMessage({ type: err.name === 'AbortError' ? 'info' : 'error', text })
    } finally {
      filesMap.current.delete(job.id)
    }
  }

  async function processQueue() {
    if (isProcessing.current) return
    isProcessing.current = true
    try {
      while (true) {
        const pending = jobsRef.current.find(j => j.status === 'pending')
        if (!pending) break
        await processJob(pending)
      }
    } finally {
      isProcessing.current = false
      // Pick up files added between last await and this finally
      if (jobsRef.current.some(j => j.status === 'pending')) processQueue()
    }
  }

  function addFiles(fileList) {
    const valid = []
    Array.from(fileList).forEach(f => {
      const isPng = f.type === 'image/png' || f.name.toLowerCase().endsWith('.png')
      if (isPng && f.size <= 2 * 1024 * 1024) valid.push(f)
    })

    if (!valid.length) {
      setMessage({ type: 'error', text: 'Only PNG files under 2 MB are accepted.' })
      return
    }

    const newJobs = valid.map(f => {
      const id = `${f.name}-${f.lastModified}-${Math.random().toString(36).slice(2)}`
      filesMap.current.set(id, f)
      return { id, fileName: f.name, originalSize: f.size, status: 'pending',
               svg: null, svgSize: null, deltaStr: null, error: null }
    })

    setMessage(null)
    updateJobs(prev => [...prev, ...newJobs])
    processQueue()
  }

  function clearQueue() {
    filesMap.current.clear()
    updateJobs([])
  }

  function downloadActive() {
    if (!activeResult) return
    triggerDownload(
      new Blob([activeResult.svg], { type: 'image/svg+xml' }),
      'penline-output.svg'
    )
  }

  function downloadJob(job) {
    const base = job.fileName.replace(/\.png$/i, '')
    triggerDownload(
      new Blob([job.svg], { type: 'image/svg+xml' }),
      `penline-${base}.svg`
    )
  }

  async function downloadAllAsZip() {
    const done = jobsRef.current.filter(j => j.status === 'done')
    if (!done.length) return
    try {
      const JSZip = await loadJSZip()
      const zip = new JSZip()
      done.forEach(job => {
        const base = job.fileName.replace(/\.png$/i, '')
        zip.file(`penline-${base}.svg`, job.svg)
      })
      const blob = await zip.generateAsync({ type: 'blob' })
      triggerDownload(blob, 'penline-batch.zip')
    } catch (err) {
      console.error('Zip failed:', err)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false)
  }
  const handleChange = (e) => {
    if (e.target.files.length) addFiles(e.target.files)
    e.target.value = ''
  }

  const isConverting = jobs.some(j => j.status === 'converting')
  const showBatch = jobs.length > 1
  const doneCount = jobs.filter(j => j.status === 'done').length

  return (
    <>
      {/* ── Section 1: above the fold ──────────────── */}
      <section className="hero">
        <div className="top-bar">
          <h1 className="wordmark">Penline.</h1>
          <span className="top-tag">pixel to path</span>
        </div>

        <div className="columns">
          {/* Left: drop zone */}
          <div className="col-left">
            <div
              className={`drop-zone${isDragging ? ' dragging' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload PNG files to convert"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
            >
              {isConverting ? (
                <div className="converting-wrap" role="status" aria-label="Converting">
                  <div className="progress-track" aria-hidden="true">
                    <div className="progress-line" />
                  </div>
                  <p className="converting-label">Converting…</p>
                </div>
              ) : (
                <div className="drop-idle">
                  <UploadIcon />
                  <span className="drop-primary">Drop PNGs here</span>
                  <span className="drop-secondary">or click to browse</span>
                  <span className="drop-hint">Multiple files supported</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,image/png"
                multiple
                onChange={handleChange}
                className="file-input-hidden"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>

            {message && (
              <p
                className={`status-msg${message.type === 'error' ? ' msg-error' : ' msg-info'}`}
                role="alert"
              >
                {message.text}
              </p>
            )}
          </div>

          {/* Right: output panel */}
          <div className="col-right">
            <div className="stat-row">
              <div className="stat-card">
                <span className="stat-label">Source</span>
                <span className={`stat-val${activeResult ? '' : ' stat-empty'}`}>
                  {activeResult ? activeResult.original : '—'}
                </span>
                {activeResult && (
                  <span className="stat-sub">{activeResult.fileName}</span>
                )}
              </div>
              <div className="stat-card">
                <span className="stat-label">Output</span>
                <span className={`stat-val output-val${activeResult ? '' : ' stat-empty'}`}>
                  {activeResult ? activeResult.svgFormatted : '—'}
                </span>
                {activeResult && (
                  <span className="stat-sub">{activeResult.deltaStr}</span>
                )}
              </div>
            </div>

            <div className="preview-card">
              {activeResult ? (
                <div
                  className="svg-render"
                  dangerouslySetInnerHTML={{ __html: activeResult.svg }}
                  aria-label="SVG preview"
                />
              ) : (
                <span className="preview-placeholder">output preview</span>
              )}
            </div>

            {activeResult && (
              <button className="download-btn" onClick={downloadActive}>
                Download SVG
              </button>
            )}
          </div>
        </div>

        <footer className="footer-bar">
          <span className="footer-text">Free · No account needed</span>
          <span className="footer-text">penline.app</span>
        </footer>
      </section>

      {/* ── Section 2: batch queue (> 1 file) ─────── */}
      {showBatch && (
        <section className="batch-section" aria-label="Batch queue">
          <div className="batch-inner">
            <div className="batch-header">
              <span className="batch-title">Batch queue · {jobs.length} files</span>
              <button className="clear-btn" onClick={clearQueue}>Clear all</button>
            </div>

            <div className="batch-list" role="list">
              {jobs.map(job => (
                <div key={job.id} className="batch-row" role="listitem">
                  <span className="batch-filename">{job.fileName}</span>
                  <div className="batch-meta">
                    {job.status === 'done' && (
                      <>
                        <span className="batch-reduction">{job.deltaStr}</span>
                        <span className="badge badge-done">Done</span>
                        <button
                          className="batch-dl"
                          onClick={() => downloadJob(job)}
                          aria-label={`Download SVG for ${job.fileName}`}
                        >
                          ↓ SVG
                        </button>
                      </>
                    )}
                    {job.status === 'converting' && (
                      <span className="badge badge-converting">Converting</span>
                    )}
                    {job.status === 'pending' && (
                      <span className="badge badge-pending">Pending</span>
                    )}
                    {job.status === 'failed' && (
                      <span className="badge badge-failed">Failed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              className="zip-btn"
              onClick={downloadAllAsZip}
              disabled={doneCount === 0}
            >
              Download all as .zip
            </button>
          </div>
        </section>
      )}
    </>
  )
}
