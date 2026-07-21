import { useEffect, useRef } from 'react'

export default function SubtleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let W = 0, H = 0

    const resize = () => {
      W = canvas.width = window.innerWidth
      H = canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = (t: number) => {
      // deep navy base
      ctx.fillStyle = '#0a0a10'
      ctx.fillRect(0, 0, W, H)

      // subtle drifting blue glow
      const cx = W/2 + Math.sin(t * 0.0002) * W * 0.12
      const cy = H * 0.4 + Math.cos(t * 0.0003) * H * 0.08
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6)
      grad.addColorStop(0, 'rgba(30,50,100,0.35)')
      grad.addColorStop(0.4, 'rgba(20,35,70,0.15)')
      grad.addColorStop(1, '#0a0a10')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    }

    let raf = 0
    const loop = (now: number) => {
      draw(now)
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
