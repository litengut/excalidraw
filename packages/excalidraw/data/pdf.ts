import type { DataURL } from "../types";

// PDF.js types
interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  destroy(): Promise<void>;
}

interface PDFPageProxy {
  getViewport(options: { scale: number }): PDFPageViewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PDFPageViewport;
  }): { promise: Promise<void> };
}

interface PDFPageViewport {
  width: number;
  height: number;
}

interface PDFLib {
  getDocument(options: {
    data: ArrayBuffer;
    cMapUrl?: string;
    cMapPacked?: boolean;
  }): { promise: Promise<PDFDocumentProxy> };
  GlobalWorkerOptions: {
    workerSrc: string;
  };
}

// Store the PDF.js library instance
let pdfLib: PDFLib | null = null;

const PDF_JS_VERSION = "4.0.379";
const PDF_JS_CDN_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_JS_VERSION}`;

/**
 * Dynamically loads PDF.js library from CDN
 */
const loadPdfJs = async (): Promise<PDFLib> => {
  if (pdfLib) {
    return pdfLib;
  }

  // Check if already loaded globally
  if ((window as any).pdfjsLib) {
    pdfLib = (window as any).pdfjsLib;
    return pdfLib!;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${PDF_JS_CDN_BASE}/pdf.min.mjs`;
    script.type = "module";

    // For module scripts, we need to use a different approach
    const moduleScript = document.createElement("script");
    moduleScript.type = "module";
    moduleScript.textContent = `
      import * as pdfjsLib from '${PDF_JS_CDN_BASE}/pdf.min.mjs';
      pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDF_JS_CDN_BASE}/pdf.worker.min.mjs';
      window.pdfjsLib = pdfjsLib;
      window.dispatchEvent(new CustomEvent('pdfjs-loaded'));
    `;

    const handleLoad = () => {
      pdfLib = (window as any).pdfjsLib;
      if (pdfLib) {
        resolve(pdfLib);
      } else {
        reject(new Error("Failed to load PDF.js library"));
      }
      window.removeEventListener("pdfjs-loaded", handleLoad);
    };

    window.addEventListener("pdfjs-loaded", handleLoad);

    moduleScript.onerror = () => {
      window.removeEventListener("pdfjs-loaded", handleLoad);
      reject(new Error("Failed to load PDF.js library"));
    };

    document.head.appendChild(moduleScript);

    // Timeout fallback
    setTimeout(() => {
      if (!pdfLib) {
        window.removeEventListener("pdfjs-loaded", handleLoad);
        reject(new Error("PDF.js loading timed out"));
      }
    }, 10000);
  });
};

export interface PDFPageImage {
  dataURL: DataURL;
  width: number;
  height: number;
  pageNumber: number;
}

/**
 * Renders a single PDF page to a canvas and returns the data URL
 */
const renderPageToDataURL = async (
  page: PDFPageProxy,
  scale: number = 2, // Higher scale for better quality
  darkMode: boolean = false,
): Promise<{ dataURL: DataURL; width: number; height: number }> => {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // Fill with background color based on theme
  context.fillStyle = darkMode ? "#121212" : "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  // Apply dark mode filter if needed
  if (darkMode) {
    // Get image data and invert colors
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      // Invert RGB values
      data[i] = 255 - data[i];         // Red
      data[i + 1] = 255 - data[i + 1]; // Green
      data[i + 2] = 255 - data[i + 2]; // Blue
      // Alpha stays the same
    }
    
    context.putImageData(imageData, 0, 0);
  }

  return {
    dataURL: canvas.toDataURL("image/png") as DataURL,
    width: viewport.width / scale, // Return dimensions at scale 1
    height: viewport.height / scale,
  };
};

/**
 * Converts a PDF file to an array of PNG images (one per page)
 */
export const convertPDFToImages = async (
  file: File,
  options: {
    scale?: number;
    maxPages?: number;
    darkMode?: boolean;
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<PDFPageImage[]> => {
  const { scale = 2, maxPages = 100, darkMode = false, onProgress } = options;

  // Load PDF.js library
  const pdfjsLib = await loadPdfJs();

  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();

  // Load the PDF document
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: `${PDF_JS_CDN_BASE}/cmaps/`,
    cMapPacked: true,
  }).promise;

  const numPages = Math.min(pdf.numPages, maxPages);
  const images: PDFPageImage[] = [];

  try {
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      onProgress?.(pageNum, numPages);

      const page = await pdf.getPage(pageNum);
      const { dataURL, width, height } = await renderPageToDataURL(page, scale, darkMode);

      images.push({
        dataURL,
        width,
        height,
        pageNumber: pageNum,
      });
    }
  } finally {
    // Clean up
    await pdf.destroy();
  }

  return images;
};

/**
 * Checks if a file is a PDF
 */
export const isPDFFile = (file: File | null | undefined): file is File => {
  if (!file) {
    return false;
  }
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
};
