import { $typst as typstSnippet } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";

let isInitialized = false;
const cache = new Map<string, string>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

export const initTypst = async () => {
  if (isInitialized) {
    return;
  }
  isInitialized = true;
};

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

export const addTypstRenderListener = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getTypstSvg = (math: string): string | null => {
  if (cache.has(math)) {
    return cache.get(math)!;
  }
  if (!pending.has(math)) {
    pending.add(math);
    renderTypstMath(math).then((svg) => {
      if (svg) {
        cache.set(math, svg);
        notifyListeners();
      }
      pending.delete(math);
    });
  }
  return null;
};

export const renderTypstMath = async (math: string): Promise<string | null> => {
  try {
    await initTypst();
    // Wrap the math in a Typst document structure that outputs SVG
    // Typst math is usually enclosed in $...$
    const result = await typstSnippet.svg({
      mainContent: "$ " + math + " $"
    });
    return result;
  } catch (error) {
    console.error("Failed to render Typst math:", error);
    return null;
  }
};

export const drawTypstMath = async (
  ctx: CanvasRenderingContext2D,
  svgString: string,
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
  opacity: number
) => {
  const img = new Image();
  const svg = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svg);

  return new Promise<void>((resolve, reject) => {
    img.onload = () => {
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate(angle);
      ctx.globalAlpha = opacity;
      // Center the image
      ctx.drawImage(img, -width / 2, -height / 2, width, height);
      ctx.restore();
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
};
