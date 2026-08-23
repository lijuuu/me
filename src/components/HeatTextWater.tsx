"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Water } from "@paper-design/shaders-react";

// Alternative to HeatText.tsx: renders the text to a canvas, then runs
// @paper-design/shaders-react's Water filter over it (Apache-2.0, real
// recursive-noise caustic shader) instead of Pixi's DisplacementFilter.

interface HeatTextWaterProps {
  lines: string[];
  fontSize: number;
  fontWeight?: number | string;
  color?: string;
  backgroundColor: string;
  lineHeight?: number;
  className?: string;
  waves?: number;
  caustic?: number;
  layering?: number;
  size?: number;
  speed?: number;
  blur?: number;
}

export default function HeatTextWater({
  lines,
  fontSize,
  fontWeight = 700,
  color = "#111111",
  backgroundColor,
  lineHeight = 1.15,
  className = "",
  waves = 0.05,
  caustic = 0.02,
  layering = 0.04,
  size = 0.8,
  speed = 0.3,
  blur = 0,
}: HeatTextWaterProps) {
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);
  const imageRef = useRef<string | null>(null);

  const dataUrl = useMemo(() => {
    // supersample well beyond device pixel ratio: this canvas is rasterized
    // once and handed to the shader as a static texture, so a sharp source
    // matters more than render cost here.
    const dpr = Math.max(3, Math.min(window.devicePixelRatio || 1, 2) * 2);
    const font = `${fontWeight} ${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;

    const measureCtx = document.createElement("canvas").getContext("2d")!;
    measureCtx.font = font;
    let maxWidth = 0;
    lines.forEach((l) => {
      maxWidth = Math.max(maxWidth, measureCtx.measureText(l).width);
    });

    const lh = fontSize * lineHeight;
    const padding = 16;
    const extraWidth = 160;
    const w = Math.ceil(maxWidth) + padding * 2 + extraWidth;
    const h = Math.ceil(lh * lines.length) + padding * 2;

    const canvas = document.createElement("canvas");
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, w, h);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    lines.forEach((l, i) => {
      ctx.fillText(l, padding, padding + fontSize * 0.86 + i * lh);
    });

    setCanvasSize({ w, h });
    return canvas.toDataURL();
  }, [lines.join("|"), fontSize, fontWeight, color, backgroundColor, lineHeight]);

  useEffect(() => {
    imageRef.current = dataUrl;
  }, [dataUrl]);

  if (!canvasSize) return null;

  return (
    <div
      className={className}
      style={{
        display: "inline-block",
        marginLeft: -16,
        filter: blur > 0 ? `blur(${blur}px)` : undefined,
      }}
    >
      <Water
        width={canvasSize.w}
        height={canvasSize.h}
        image={dataUrl}
        colorBack={backgroundColor}
        colorHighlight="#ffffff"
        highlights={0}
        layering={layering}
        edges={0}
        waves={waves}
        caustic={caustic}
        size={size}
        speed={speed}
        scale={1}
        fit="contain"
        minPixelRatio={3}
      />
    </div>
  );
}
