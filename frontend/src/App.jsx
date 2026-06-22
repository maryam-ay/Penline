import { useState, useRef, useCallback } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const TIMEOUT_MS = 15_000

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

export default function App() {
  const [state, setState] = useState('idle') // idle | processing | success | error
  const [svgContent, setSvgContent] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [fileStats, setFileStats] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const processFile = useCallback(async (file) => {
    if (!file) return

    if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
      setErrorMessage('Only PNG files are accepted.')
      setState('error')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage('File must be under 2 MB.')
      setState('error')
      return
    }

    setState('processing')
    setErrorMessage('')

    const originalSize = file.size
    const formData = new FormData()
    formData.append('file', file)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(`${API_URL}/convert`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErrorMessage(data.error || 'Conversion failed.')
        setState('error')
        return
      }

      const data = await res.json()
      const svgSize = new Blob([data.svg]).size
      const delta = Math.round((1 - svgSize / originalSize) * 100)

      setSvgContent(data.svg)
      setFileStats({
        original: formatBytes(originalSize),
        svg: formatBytes(svgSize),
        delta: delta > 0 ? `−${delta}%` : `+${Math.abs(delta)}%`,
      })
      setState('success')
    } catch (err) {
      clearTimeout(timer)
      if (err.name === 'AbortError') {
        setErrorMessage('Server is warming up. Try again in a moment.')
      } else {
        setErrorMessage(err.message || 'Something went wrong.')
      }
      setState('error')
    }
  }, [])

  const handleChange = (e) => {
    const file = e.target.files[0]
    if (file) processFile(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false)
  }

  const handleDownload = () => {
    const blob = new Blob([svgContent], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'penline-output.svg'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setState('idle')
    setSvgContent('')
    setErrorMessage('')
    setFileStats(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const showUploadZone = state === 'idle' || state === 'error'

  return (
    <div className="page">
      <div className="container">
        <header className="header">
          <h1 className="wordmark">Penline.</h1>
          <p className="tagline">Pixel to path.</p>
        </header>

        <main>
          {showUploadZone && (
            <div
              className={`upload-zone${isDragging ? ' dragging' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload a PNG file to convert"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
            >
              <span className="upload-primary">Drop a PNG here</span>
              <span className="upload-secondary">or click to browse</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,image/png"
                onChange={handleChange}
                className="file-input"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          )}

          {state === 'error' && (
            <p className="error-message" role="alert">{errorMessage}</p>
          )}

          {state === 'processing' && (
            <div className="processing-wrap" role="status" aria-label="Converting">
              <div className="progress-track" aria-hidden="true">
                <div className="progress-line" />
              </div>
              <p className="processing-label">Converting…</p>
            </div>
          )}

          {state === 'success' && (
            <div className="result">
              <div
                className="svg-preview"
                dangerouslySetInnerHTML={{ __html: svgContent }}
                aria-label="SVG preview"
              />
              <div className="file-stats">
                <span className="stat">PNG  →  {fileStats.original}</span>
                <span className="stat">SVG  →  {fileStats.svg}  ({fileStats.delta})</span>
              </div>
              <button className="download-btn" onClick={handleDownload}>
                Download SVG
              </button>
              <button className="reset-link" onClick={handleReset}>
                Convert another
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
