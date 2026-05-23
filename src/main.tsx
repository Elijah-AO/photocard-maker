import React, { ChangeEvent, PointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Crosshair, Download, ImageUp, LocateFixed, RotateCcw } from "lucide-react";
import "./styles.css";

const MM_PER_INCH = 25.4;
const PREVIEW_WIDTH = 340;
const DEFAULT_RADIUS_PREVIEW_PX = 24;

type CardSettings = {
  widthMm: number;
  heightMm: number;
  dpi: number;
  cornerRadiusPreviewPx: number;
};

type ImageTransform = {
  positionX: number;
  positionY: number;
  scale: number;
};

type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPositionX: number;
  startPositionY: number;
};

type RenderOptions = {
  canvas: HTMLCanvasElement;
  image: HTMLImageElement | null;
  outputWidth: number;
  outputHeight: number;
  renderWidth: number;
  renderHeight: number;
  positionX: number;
  positionY: number;
  scale: number;
  radiusPx: number;
  showPlaceholder?: boolean;
};

function mmToPixels(mm: number, dpi: number) {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

function roundedRectPath(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));

  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height);
  ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
}

function drawPhotocard({
  canvas,
  image,
  outputWidth,
  outputHeight,
  renderWidth,
  renderHeight,
  positionX,
  positionY,
  scale,
  radiusPx,
  showPlaceholder = false
}: RenderOptions) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = renderWidth;
  canvas.height = renderHeight;
  ctx.clearRect(0, 0, renderWidth, renderHeight);

  roundedRectPath(ctx, renderWidth, renderHeight, radiusPx);
  ctx.save();
  ctx.clip();

  if (image) {
    // Position and scale are stored in final-output pixels, then translated into
    // the current canvas size so preview and export use the same crop.
    const previewScaleX = renderWidth / outputWidth;
    const previewScaleY = renderHeight / outputHeight;
    const imageWidth = image.naturalWidth * scale * previewScaleX;
    const imageHeight = image.naturalHeight * scale * previewScaleX;
    const imageX = renderWidth / 2 + positionX * previewScaleX - imageWidth / 2;
    const imageY = renderHeight / 2 + positionY * previewScaleY - imageHeight / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, imageX, imageY, imageWidth, imageHeight);
  } else if (showPlaceholder) {
    ctx.fillStyle = "#f7f4ef";
    ctx.fillRect(0, 0, renderWidth, renderHeight);
  }

  ctx.restore();
}

function clampPositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function App() {
  const [settings, setSettings] = useState<CardSettings>({
    widthMm: 55,
    heightMm: 85,
    dpi: 300,
    cornerRadiusPreviewPx: DEFAULT_RADIUS_PREVIEW_PX
  });
  const [transform, setTransform] = useState<ImageTransform>({
    positionX: 0,
    positionY: 0,
    scale: 1
  });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const outputSize = useMemo(
    () => ({
      width: mmToPixels(settings.widthMm, settings.dpi),
      height: mmToPixels(settings.heightMm, settings.dpi)
    }),
    [settings.widthMm, settings.heightMm, settings.dpi]
  );

  const previewSize = useMemo(() => {
    const ratio = settings.heightMm / settings.widthMm;
    return {
      width: PREVIEW_WIDTH,
      height: Math.round(PREVIEW_WIDTH * ratio)
    };
  }, [settings.widthMm, settings.heightMm]);

  const sliderBounds = useMemo(
    () => ({
      minX: -outputSize.width,
      maxX: outputSize.width,
      minY: -outputSize.height,
      maxY: outputSize.height
    }),
    [outputSize.width, outputSize.height]
  );

  useEffect(() => {
    if (!canvasRef.current) return;

    drawPhotocard({
      canvas: canvasRef.current,
      image,
      outputWidth: outputSize.width,
      outputHeight: outputSize.height,
      renderWidth: previewSize.width,
      renderHeight: previewSize.height,
      positionX: transform.positionX,
      positionY: transform.positionY,
      scale: transform.scale,
      radiusPx: settings.cornerRadiusPreviewPx,
      showPlaceholder: true
    });
  }, [image, outputSize, previewSize, settings.cornerRadiusPreviewPx, transform]);

  useEffect(() => {
    return () => {
      if (image?.src.startsWith("blob:")) {
        URL.revokeObjectURL(image.src);
      }
    };
  }, [image]);

  function updateSetting(key: keyof CardSettings, value: number) {
    setSettings((current) => ({
      ...current,
      [key]:
        key === "cornerRadiusPreviewPx"
          ? Math.max(0, value)
          : clampPositive(value, current[key])
    }));
  }

  function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const nextImage = new Image();
    nextImage.onload = () => {
      if (image?.src.startsWith("blob:")) {
        URL.revokeObjectURL(image.src);
      }
      setImage(nextImage);
      setFileName(file.name);
      setTransform({ positionX: 0, positionY: 0, scale: 1 });
    };
    nextImage.src = objectUrl;
  }

  function resetPosition() {
    setTransform({ positionX: 0, positionY: 0, scale: 1 });
  }

  function centerImage() {
    setTransform((current) => ({ ...current, positionX: 0, positionY: 0 }));
  }

  function exportPng() {
    const exportCanvas = document.createElement("canvas");
    // The UI slider is expressed in preview pixels; scale it up to the exact
    // export canvas so transparent rounded corners match the visible card.
    const exportRadius = settings.cornerRadiusPreviewPx / (previewSize.width / outputSize.width);

    drawPhotocard({
      canvas: exportCanvas,
      image,
      outputWidth: outputSize.width,
      outputHeight: outputSize.height,
      renderWidth: outputSize.width,
      renderHeight: outputSize.height,
      positionX: transform.positionX,
      positionY: transform.positionY,
      scale: transform.scale,
      radiusPx: exportRadius
    });

    exportCanvas.toBlob((blob) => {
      if (!blob) return;

      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `kpop-photocard-${outputSize.width}x${outputSize.height}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!canvasRef.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPositionX: transform.positionX,
      startPositionY: transform.positionY
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvasRef.current) return;

    const bounds = canvasRef.current.getBoundingClientRect();
    const previewToOutputX = outputSize.width / bounds.width;
    const previewToOutputY = outputSize.height / bounds.height;

    setTransform((current) => ({
      ...current,
      positionX: Math.round(drag.startPositionX + (event.clientX - drag.startClientX) * previewToOutputX),
      positionY: Math.round(drag.startPositionY + (event.clientY - drag.startClientY) * previewToOutputY)
    }));
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setIsDragging(false);
    }
  }

  function handleWheel(event: WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setTransform((current) => ({
      ...current,
      scale: Number(Math.max(0.05, Math.min(5, current.scale + direction * 0.05)).toFixed(2))
    }));
  }

  return (
    <main className="app-shell">
      <section className="control-panel" aria-label="Photocard controls">
        <div>
          <p className="eyebrow">Local canvas editor</p>
          <h1>K-pop Photocard Maker</h1>
        </div>

        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={uploadImage}
        />

        <div className="button-row">
          <button type="button" className="primary-action" onClick={() => fileInputRef.current?.click()}>
            <ImageUp size={18} aria-hidden="true" />
            Upload image
          </button>
          <button type="button" onClick={exportPng}>
            <Download size={18} aria-hidden="true" />
            Export PNG
          </button>
        </div>

        <div className="button-row">
          <button type="button" onClick={resetPosition}>
            <RotateCcw size={18} aria-hidden="true" />
            Reset position
          </button>
          <button type="button" onClick={centerImage}>
            <LocateFixed size={18} aria-hidden="true" />
            Center image
          </button>
        </div>

        <div className="status-strip">
          <span>{fileName || "No image selected"}</span>
          <strong>
            {outputSize.width} x {outputSize.height} px
          </strong>
          <span>
            {settings.widthMm} x {settings.heightMm} mm at {settings.dpi} DPI
          </span>
        </div>

        <div className="control-group">
          <label>
            Zoom
            <span>{transform.scale.toFixed(2)}x</span>
          </label>
          <input
            type="range"
            min="0.05"
            max="5"
            step="0.01"
            value={transform.scale}
            onChange={(event) =>
              setTransform((current) => ({ ...current, scale: Number(event.target.value) }))
            }
          />
        </div>

        <div className="control-group">
          <label>
            X position
            <span>{transform.positionX}px</span>
          </label>
          <input
            type="range"
            min={sliderBounds.minX}
            max={sliderBounds.maxX}
            step="1"
            value={transform.positionX}
            onChange={(event) =>
              setTransform((current) => ({ ...current, positionX: Number(event.target.value) }))
            }
          />
        </div>

        <div className="control-group">
          <label>
            Y position
            <span>{transform.positionY}px</span>
          </label>
          <input
            type="range"
            min={sliderBounds.minY}
            max={sliderBounds.maxY}
            step="1"
            value={transform.positionY}
            onChange={(event) =>
              setTransform((current) => ({ ...current, positionY: Number(event.target.value) }))
            }
          />
        </div>

        <div className="control-group">
          <label>
            Corner radius
            <span>{settings.cornerRadiusPreviewPx}px preview</span>
          </label>
          <input
            type="range"
            min="0"
            max="80"
            step="1"
            value={settings.cornerRadiusPreviewPx}
            onChange={(event) => updateSetting("cornerRadiusPreviewPx", Number(event.target.value))}
          />
        </div>

        <div className="size-grid">
          <label>
            Width mm
            <input
              type="number"
              min="1"
              step="0.1"
              value={settings.widthMm}
              onChange={(event) => updateSetting("widthMm", Number(event.target.value))}
            />
          </label>
          <label>
            Height mm
            <input
              type="number"
              min="1"
              step="0.1"
              value={settings.heightMm}
              onChange={(event) => updateSetting("heightMm", Number(event.target.value))}
            />
          </label>
          <label>
            DPI
            <input
              type="number"
              min="72"
              step="1"
              value={settings.dpi}
              onChange={(event) => updateSetting("dpi", Number(event.target.value))}
            />
          </label>
        </div>
      </section>

      <section className="preview-stage" aria-label="Photocard preview">
        <div className="preview-header">
          <div>
            <p className="eyebrow">Preview</p>
            <h2>Rounded transparent crop</h2>
          </div>
          <div className="preview-meta">
            <Crosshair size={18} aria-hidden="true" />
            Drag canvas or use wheel
          </div>
        </div>

        <div className="checkerboard">
          <canvas
            ref={canvasRef}
            className={isDragging ? "dragging" : ""}
            style={{
              aspectRatio: `${previewSize.width} / ${previewSize.height}`,
              width: `${previewSize.width}px`,
              borderRadius: `${settings.cornerRadiusPreviewPx}px`
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          />
        </div>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
