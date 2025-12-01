// @ts-ignore - typst.ts module resolution
import { $typst, TypstSnippet } from "@myriaddreamin/typst.ts/contrib/snippet";

import { MIME_TYPES } from "@excalidraw/common";
import { normalizeSVG, loadHTMLImageElement } from "@excalidraw/element";
import type { ExcalidrawTextElement } from "@excalidraw/element/types";
import type { DataURL } from "../types";

// CDN URLs for WASM modules
const TYPST_COMPILER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.6.1-rc5/pkg/typst_ts_web_compiler_bg.wasm";
const TYPST_RENDERER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@0.6.1-rc5/pkg/typst_ts_renderer_bg.wasm";

// Caveat font (handwriting style similar to Excalifont) - TTF format for Typst
// Using jsDelivr CDN which supports proper CORS headers
const CAVEAT_FONT_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/caveat@main/fonts/ttf/Caveat-Regular.ttf";

// Cache for rendered typst SVGs and images
interface TypstCacheEntry {
  svg: string;
  image: HTMLImageElement | Promise<HTMLImageElement>;
  width: number;
  height: number;
}

const typstCache = new Map<string, TypstCacheEntry>();

// Track initialization state
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Fetch font data as Uint8Array
 */
const fetchFontData = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
};

/**
 * Initialize the typst compiler and renderer with WASM modules.
 * This is called lazily when needed.
 */
const initTypst = async (): Promise<void> => {
  if (isInitialized) {
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      $typst.setCompilerInitOptions({
        getModule: () => TYPST_COMPILER_WASM_URL,
      });
      $typst.setRendererInitOptions({
        getModule: () => TYPST_RENDERER_WASM_URL,
      });

      // Load Caveat font (TTF format works with Typst)
      const fontData = await fetchFontData(CAVEAT_FONT_URL);
      console.log("Loaded Caveat font data:", fontData.byteLength, "bytes");

      // Register font using preloadFonts provider
      $typst.use(TypstSnippet.preloadFonts([fontData]));

      isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize typst:", error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
};

/**
 * Generate a cache key for a typst render request
 */
const getCacheKey = (
  text: string,
  fontSize: number,
  fontFamily: number,
  strokeColor: string,
): string => {
  return `${text}__${fontSize}__${fontFamily}__${strokeColor}`;
};

/**
 * Wrap typst content with proper preamble that sets styling
 */
const wrapTypstContent = (
  content: string,
  element: ExcalidrawTextElement,
): string => {
  const fontSize = element.fontSize;
  const color = element.strokeColor;

  // Create a typst document with Caveat font (handwriting style)
  // Add margin to prevent clipping on all sides
  // Note: The font name "Caveat" must match the font family in the TTF
  return `#set page(width: auto, height: auto, margin: 8pt)
#set text(size: ${fontSize}pt, fill: rgb("${color.replace("#", "")}"), font: "Caveat")
${content}`;
};

/**
 * Parse SVG to get dimensions
 */
const getSvgDimensions = (svg: string): { width: number; height: number } => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const svgElement = doc.querySelector("svg");

  if (!svgElement) {
    return { width: 100, height: 100 };
  }

  let width = parseFloat(svgElement.getAttribute("width") || "100");
  let height = parseFloat(svgElement.getAttribute("height") || "100");

  // Handle viewBox if width/height not set
  if (!width || !height) {
    const viewBox = svgElement.getAttribute("viewBox");
    if (viewBox) {
      const parts = viewBox.split(/\s+/);
      if (parts.length >= 4) {
        width = parseFloat(parts[2]) || 100;
        height = parseFloat(parts[3]) || 100;
      }
    }
  }

  return { width, height };
};

/**
 * Sanitize SVG for image conversion
 * Removes problematic elements that can cause image loading to fail
 */
const sanitizeSvgForImage = (svg: string): string => {
  let sanitized = svg;

  // Remove script tags (they contain unescaped < > which break SVG loading)
  sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

  // Remove style tags that can cause issues
  sanitized = sanitized.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove foreignObject elements (they won't render in image context)
  sanitized = sanitized.replace(/<foreignObject[^>]*>[\s\S]*?<\/foreignObject>/gi, "");

  // Remove problematic namespace declarations
  sanitized = sanitized.replace(/xmlns:h5="[^"]*"/g, "");

  // Remove class attributes that reference removed styles
  sanitized = sanitized.replace(/\s+class="[^"]*"/g, "");

  return sanitized;
};

/**
 * Convert SVG string to data URL
 */
const svgToDataUrl = (svg: string): DataURL => {
  const base64 = btoa(unescape(encodeURIComponent(svg)));
  return `data:${MIME_TYPES.svg};base64,${base64}` as DataURL;
};

/**
 * Convert SVG string to HTMLImageElement using excalidraw's utilities
 */
const svgToImage = async (svg: string, width: number, height: number): Promise<HTMLImageElement> => {
  // Sanitize SVG first
  const sanitizedSvg = sanitizeSvgForImage(svg);
  
  // Use excalidraw's normalizeSVG to ensure proper format
  const normalizedSvg = normalizeSVG(sanitizedSvg);
  
  // Convert to data URL
  const dataUrl = svgToDataUrl(normalizedSvg);
  
  // Use excalidraw's loadHTMLImageElement
  return loadHTMLImageElement(dataUrl);
};

/**
 * Render typst content to SVG and cache as image
 */
export const renderTypstToSvg = async (
  element: ExcalidrawTextElement,
): Promise<TypstCacheEntry | null> => {
  const { text, fontSize, fontFamily, strokeColor } = element;

  // Check cache first
  const cacheKey = getCacheKey(text, fontSize, fontFamily, strokeColor);
  const cached = typstCache.get(cacheKey);
  if (cached) {
    // Wait for image if it's still loading
    if (cached.image instanceof Promise) {
      cached.image = await cached.image;
    }
    return cached;
  }

  try {
    // Ensure typst is initialized
    await initTypst();

    // Wrap content with proper styling
    const typstContent = wrapTypstContent(text, element);

    // Render to SVG
    const svg = await $typst.svg({
      mainContent: typstContent,
    });

    // Debug: log the SVG content
    console.log("Typst rendered SVG:", svg.substring(0, 200));

    // Validate SVG
    if (!svg || typeof svg !== "string" || !svg.includes("<svg")) {
      console.error("Invalid SVG output from typst:", svg);
      return null;
    }

    // Get dimensions
    const { width, height } = getSvgDimensions(svg);

    // Create image from SVG at 2x resolution
    const imagePromise = svgToImage(svg, width, height);

    // Create cache entry with promise
    const entry: TypstCacheEntry = {
      svg,
      image: imagePromise,
      width,
      height,
    };

    // Cache immediately with promise
    typstCache.set(cacheKey, entry);

    // Wait for image to load
    entry.image = await imagePromise;

    return entry;
  } catch (error) {
    console.error("Failed to render typst content:", error);
    return null;
  }
};

/**
 * Get cached typst render result (synchronous)
 */
export const getTypstCacheEntry = (
  element: ExcalidrawTextElement,
): TypstCacheEntry | null => {
  const { text, fontSize, fontFamily, strokeColor } = element;
  const cacheKey = getCacheKey(text, fontSize, fontFamily, strokeColor);
  const cached = typstCache.get(cacheKey);

  if (cached && !(cached.image instanceof Promise)) {
    return cached;
  }

  return null;
};

/**
 * Check if a typst element has a cached render
 */
export const hasTypstCache = (element: ExcalidrawTextElement): boolean => {
  const { text, fontSize, fontFamily, strokeColor } = element;
  const cacheKey = getCacheKey(text, fontSize, fontFamily, strokeColor);
  const cached = typstCache.get(cacheKey);
  return cached !== undefined && !(cached.image instanceof Promise);
};

/**
 * Clear the typst cache
 */
export const clearTypstCache = (): void => {
  typstCache.clear();
};

/**
 * Remove a specific element from the cache
 */
export const invalidateTypstCache = (element: ExcalidrawTextElement): void => {
  const { text, fontSize, fontFamily, strokeColor } = element;
  const cacheKey = getCacheKey(text, fontSize, fontFamily, strokeColor);
  typstCache.delete(cacheKey);
};

/**
 * Check if typst is available (WASM can be loaded)
 */
export const isTypstAvailable = async (): Promise<boolean> => {
  try {
    await initTypst();
    return true;
  } catch {
    return false;
  }
};
