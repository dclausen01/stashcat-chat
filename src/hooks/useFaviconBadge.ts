import { useEffect, useRef } from 'react';

const ORIGINAL_HREF = '/bbz-logo-neu.png';

/**
 * Draws a red dot badge on the favicon when `count > 0`.
 * Uses a canvas to composite the original favicon with a red circle overlay.
 */
export function useFaviconBadge(count: number) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;

    if (count <= 0) {
      // Restore original favicon
      link.href = ORIGINAL_HREF;
      return;
    }

    // Create canvas to draw favicon + badge
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 64;
      canvasRef.current.height = 64;
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(img, 0, 0, 64, 64);

      // Red dot — bottom-right corner
      const dotRadius = 12;
      const cx = 64 - dotRadius - 2;
      const cy = 64 - dotRadius - 2;

      // White outline
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius + 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Red dot
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();

      // Number text (if small enough)
      if (count <= 99) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${count > 9 ? 11 : 14}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(count), cx, cy + 1);
      }

      link.href = canvas.toDataURL('image/png');
    };
    img.src = ORIGINAL_HREF;
  }, [count]);
}
