import { useEffect, useRef, useCallback } from 'react'

const GRID = 25
const FADE = 0.008
const MAX_RINGS = 6
const ACCENT = { r: 37, g: 99, b: 235 }
const DOT = 'rgba(0,0,0,0.04)'
const BG = '#ffffff'

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export default function PixelGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixelsRef = useRef<Map<string, number>>(new Map())
  const patternRef = useRef<CanvasPattern | null>(null)
  const rafRef = useRef(0)

  const makePattern = useCallback(() => {
    const c = document.createElement('canvas')
    c.width = GRID
    c.height = GRID
    const ctx = c.getContext('2d')!
    ctx.fillStyle = DOT
    ctx.fillRect(0, 0, 1, 1)
    patternRef.current = ctx.createPattern(c, 'repeat')
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width: W, height: H } = canvas

    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)

    if (patternRef.current) {
      ctx.fillStyle = patternRef.current
      ctx.fillRect(0, 0, W, H)
    }

    let has = false
    pixelsRef.current.forEach((v, k) => {
      if (v <= 0.01) { pixelsRef.current.delete(k); return }
      has = true
      const [px, py] = k.split(',').map(Number)
      const t = clamp(v, 0, 1)
      const r = Math.round(ACCENT.r + (255 - ACCENT.r) * (1 - t))
      const g = Math.round(ACCENT.g + (255 - ACCENT.g) * (1 - t))
      const b = Math.round(ACCENT.b + (255 - ACCENT.b) * (1 - t))
      const alpha = 0.25 + t * 0.75
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
      ctx.fillRect(px, py, GRID, GRID)
    })
    return has
  }, [])

  const animate = useCallback(() => {
    let any = false
    pixelsRef.current.forEach((v, k) => {
      const nv = v - FADE
      if (nv <= 0.01) pixelsRef.current.delete(k)
      else { pixelsRef.current.set(k, nv); any = true }
    })
    const has = draw()
    if (any || has) rafRef.current = requestAnimationFrame(animate)
  }, [draw])

  const trigger = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(animate)
  }, [animate])

  const handleClick = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return
    const gx = Math.round(e.clientX / GRID) * GRID
    const gy = Math.round(e.clientY / GRID) * GRID

    const rings = Math.floor(Math.random() * 3) + 4
    const visited = new Set<string>()
    const frontier: Array<[number, number, number]> = [[gx, gy, 0]]
    visited.add(`${gx},${gy}`)
    let idx = 0

    while (idx < frontier.length) {
      const [x, y, depth] = frontier[idx++]
      const intensity = clamp(1 - depth / rings, 0.1, 1)
      const key = `${x},${y}`
      const cur = pixelsRef.current.get(key) || 0
      pixelsRef.current.set(key, Math.max(cur, intensity))

      if (depth >= rings - 1) continue

      const neighbors = shuffle([
        [x - GRID, y] as [number, number],
        [x + GRID, y] as [number, number],
        [x, y - GRID] as [number, number],
        [x, y + GRID] as [number, number],
      ])

      for (const [nx, ny] of neighbors) {
        const nk = `${nx},${ny}`
        if (visited.has(nk)) continue
        visited.add(nk)
        const prob = Math.max(0.12, 1 - (depth / rings) * 0.95)
        if (Math.random() > prob) continue
        frontier.push([nx, ny, depth + 1])
      }
    }

    draw()
    trigger()
  }, [draw, trigger])

  useEffect(() => {
    const canvas = canvasRef.current!

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      draw()
    }

    resize()
    makePattern()
    draw()
    window.addEventListener('resize', resize)
    document.addEventListener('click', handleClick)

    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('click', handleClick)
      cancelAnimationFrame(rafRef.current)
    }
  }, [handleClick, draw, makePattern])

  return <canvas ref={canvasRef} className="fixed inset-0" style={{ zIndex: 0, pointerEvents: 'none' }} />
}
