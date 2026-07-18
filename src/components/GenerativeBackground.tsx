import { useEffect, useRef } from 'react'

const CELL = 18
const RADIUS = 0.5
const GRID_COLOR = 'rgba(6,26,110,0.20)'
const FILL = '#2D6BFF'
const FPS = 24

class Simplex {
  private grad3 = [
    [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
    [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
    [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
  ]
  private perm: number[] = []

  constructor() {
    const p: number[] = []
    for (let i = 0; i < 256; i++) p[i] = i
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]]
    }
    this.perm = new Array(512)
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]
  }

  private dot(g: number[], x: number, y: number, z: number) { return g[0]*x + g[1]*y + g[2]*z }
  private fade(t: number) { return t*t*t*(t*(t*6-15)+10) }
  private lerp(t: number, a: number, b: number) { return a+t*(b-a) }

  private grad(hash: number, x: number, y: number, z: number) {
    return this.dot(this.grad3[hash % 12], x, y, z)
  }

  noise3D(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255
    x-=Math.floor(x); y-=Math.floor(y); z-=Math.floor(z)
    const u=this.fade(x), v=this.fade(y), w=this.fade(z)
    const A=this.perm[X]+Y, AA=this.perm[A]+Z, AB=this.perm[A+1]+Z
    const B=this.perm[X+1]+Y, BA=this.perm[B]+Z, BB=this.perm[B+1]+Z
    return this.lerp(w,
      this.lerp(v,
        this.lerp(u, this.grad(this.perm[AA],x,y,z), this.grad(this.perm[BA],x-1,y,z)),
        this.lerp(u, this.grad(this.perm[AB],x,y-1,z), this.grad(this.perm[BB],x-1,y-1,z)),
      ),
      this.lerp(v,
        this.lerp(u, this.grad(this.perm[AA+1],x,y,z-1), this.grad(this.perm[BA+1],x-1,y,z-1)),
        this.lerp(u, this.grad(this.perm[AB+1],x,y-1,z-1), this.grad(this.perm[BB+1],x-1,y-1,z-1)),
      ),
    )
  }
}

export default function GenerativeBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const simplexRef = useRef(new Simplex())

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    let W = 0, H = 0, cols = 0, rows = 0

    const resize = () => {
      W = canvas.width = window.innerWidth
      H = canvas.height = window.innerHeight
      cols = Math.ceil(W / CELL) + 1
      rows = Math.ceil(H / CELL) + 1
      buildGridLayer()
    }

    const buildGridLayer = () => {
      const gc = document.createElement('canvas')
      gc.width = W
      gc.height = H
      const gctx = gc.getContext('2d')!
      gctx.strokeStyle = GRID_COLOR
      gctx.lineWidth = 0.5
      for (let cx = 0; cx <= cols; cx++) {
        const x = cx * CELL
        gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, H); gctx.stroke()
      }
      for (let ry = 0; ry <= rows; ry++) {
        const y = ry * CELL
        gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(W, y); gctx.stroke()
      }
      gridCanvasRef.current = gc
    }

    const noise = simplexRef.current
    let centerX = 0, centerY = 0, gradW = 0

    const draw = (t: number) => {
      centerX = W / 2; centerY = H / 2; gradW = Math.max(W, H)

      const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, gradW * 0.7)
      grad.addColorStop(0, '#225BFF')
      grad.addColorStop(0.5, '#1750E5')
      grad.addColorStop(1, '#0B37B8')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)

      if (gridCanvasRef.current) {
        ctx.drawImage(gridCanvasRef.current, 0, 0)
      }

      const timeSlow = t * 0.00018
      const noiseScale = 0.004
      const edge0 = -0.20
      const edge1 = 0.60

      ctx.fillStyle = FILL

      for (let cy = 0; cy < cols; cy++) {
        const nx = cy * CELL * noiseScale
        for (let ry = 0; ry < rows; ry++) {
          const ny = ry * CELL * noiseScale
          const base = noise.noise3D(nx, ny, timeSlow)
          const detail = noise.noise3D(nx + 100, ny + 100, timeSlow * 0.6) * 0.22
          const raw = base + detail
          const t = Math.max(0, Math.min(1, (raw - edge0) / (edge1 - edge0)))
          const alpha = t * t * (3 - 2 * t)
          if (alpha < 0.03) continue
          ctx.globalAlpha = alpha
          const x = cy * CELL
          const y = ry * CELL
          ctx.beginPath()
          ctx.moveTo(x + RADIUS, y)
          ctx.lineTo(x + CELL - RADIUS, y)
          ctx.quadraticCurveTo(x + CELL, y, x + CELL, y + RADIUS)
          ctx.lineTo(x + CELL, y + CELL - RADIUS)
          ctx.quadraticCurveTo(x + CELL, y + CELL, x + CELL - RADIUS, y + CELL)
          ctx.lineTo(x + RADIUS, y + CELL)
          ctx.quadraticCurveTo(x, y + CELL, x, y + CELL - RADIUS)
          ctx.lineTo(x, y + RADIUS)
          ctx.quadraticCurveTo(x, y, x + RADIUS, y)
          ctx.closePath()
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    let last = performance.now()

    const loop = (now: number) => {
      if (now - last >= 1000 / FPS) {
        last = now
        draw(now)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0" style={{ zIndex: 0, pointerEvents: 'none' }} />
}
