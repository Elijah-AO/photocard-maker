import React, { ChangeEvent, PointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { ArrowDown, ArrowUp, Crosshair, Download, FileText, ImageUp, LocateFixed, RotateCcw, Trash2 } from "lucide-react";
import { jsPDF } from "jspdf";
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

type AppTab = "editor" | "sheet";
type PaperSizeKey = "a4" | "letter";
type OrientationSetting = "auto" | "portrait" | "landscape";

type SheetSettings = {
  paperSize: PaperSizeKey;
  orientation: OrientationSetting;
  cardWidthMm: number;
  cardHeightMm: number;
  gapMm: number;
  marginMm: number;
  cropMarks: boolean;
};

type UploadedCard = {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
};

type GridPosition = {
  index: number;
  column: number;
  row: number;
  x: number;
  y: number;
};

type GridLayout = {
  columns: number;
  rows: number;
  cardsPerPage: number;
  startX: number;
  startY: number;
  gridWidth: number;
  gridHeight: number;
  positions: GridPosition[];
};

const PAPER_SIZES: Record<PaperSizeKey, { label: string; widthMm: number; heightMm: number }> = {
  a4: { label: "A4", widthMm: 210, heightMm: 297 },
  letter: { label: "US Letter", widthMm: 215.9, heightMm: 279.4 }
};

function mmToPixels(mm: number, dpi: number) {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

function calculateGridLayout({
  pageWidthMm,
  pageHeightMm,
  marginMm,
  gapMm,
  cardWidthMm,
  cardHeightMm
}: {
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  gapMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
}): GridLayout {
  const availableWidth = Math.max(0, pageWidthMm - marginMm * 2);
  const availableHeight = Math.max(0, pageHeightMm - marginMm * 2);
  const columns = Math.max(0, Math.floor((availableWidth + gapMm) / (cardWidthMm + gapMm)));
  const rows = Math.max(0, Math.floor((availableHeight + gapMm) / (cardHeightMm + gapMm)));
  const cardsPerPage = columns * rows;
  const gridWidth = columns > 0 ? columns * cardWidthMm + (columns - 1) * gapMm : 0;
  const gridHeight = rows > 0 ? rows * cardHeightMm + (rows - 1) * gapMm : 0;
  const startX = (pageWidthMm - gridWidth) / 2;
  const startY = (pageHeightMm - gridHeight) / 2;
  const positions = Array.from({ length: cardsPerPage }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      index,
      column,
      row,
      x: startX + column * (cardWidthMm + gapMm),
      y: startY + row * (cardHeightMm + gapMm)
    };
  });

  return { columns, rows, cardsPerPage, startX, startY, gridWidth, gridHeight, positions };
}

function getPaperDimensions(paperSize: PaperSizeKey, orientation: Exclude<OrientationSetting, "auto">) {
  const paper = PAPER_SIZES[paperSize];
  return orientation === "portrait"
    ? { widthMm: paper.widthMm, heightMm: paper.heightMm }
    : { widthMm: paper.heightMm, heightMm: paper.widthMm };
}

function resolveSheetLayout(settings: SheetSettings) {
  const orientations: Array<Exclude<OrientationSetting, "auto">> =
    settings.orientation === "auto" ? ["portrait", "landscape"] : [settings.orientation];
  const layouts = orientations.map((orientation) => {
    const page = getPaperDimensions(settings.paperSize, orientation);
    const layout = calculateGridLayout({
      pageWidthMm: page.widthMm,
      pageHeightMm: page.heightMm,
      marginMm: settings.marginMm,
      gapMm: settings.gapMm,
      cardWidthMm: settings.cardWidthMm,
      cardHeightMm: settings.cardHeightMm
    });

    return { orientation, ...page, layout };
  });

  return layouts.sort((a, b) => b.layout.cardsPerPage - a.layout.cardsPerPage)[0];
}

function getImagePlacement(
  imageWidth: number,
  imageHeight: number,
  slotX: number,
  slotY: number,
  slotWidth: number,
  slotHeight: number
) {
  const imageRatio = imageWidth / imageHeight;
  const slotRatio = slotWidth / slotHeight;

  if (imageRatio > slotRatio) {
    const width = slotWidth;
    const height = slotWidth / imageRatio;
    return { x: slotX, y: slotY + (slotHeight - height) / 2, width, height };
  }

  const height = slotHeight;
  const width = slotHeight * imageRatio;
  return { x: slotX + (slotWidth - width) / 2, y: slotY, width, height };
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

function readCardFile(file: File): Promise<UploadedCard> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const previewImage = new Image();

      previewImage.onload = () => {
        resolve({
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          dataUrl,
          width: previewImage.naturalWidth,
          height: previewImage.naturalHeight
        });
      };
      previewImage.onerror = () => reject(new Error(`Could not load ${file.name}`));
      previewImage.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}

function drawPdfCropMarks(doc: jsPDF, x: number, y: number, width: number, height: number) {
  const markLength = 3;
  const offset = 1;
  const left = x;
  const right = x + width;
  const top = y;
  const bottom = y + height;

  doc.line(left - offset - markLength, top, left - offset, top);
  doc.line(left, top - offset - markLength, left, top - offset);
  doc.line(right + offset, top, right + offset + markLength, top);
  doc.line(right, top - offset - markLength, right, top - offset);
  doc.line(left - offset - markLength, bottom, left - offset, bottom);
  doc.line(left, bottom + offset, left, bottom + offset + markLength);
  doc.line(right + offset, bottom, right + offset + markLength, bottom);
  doc.line(right, bottom + offset, right, bottom + offset + markLength);
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("editor");
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
  const [sheetSettings, setSheetSettings] = useState<SheetSettings>({
    paperSize: "a4",
    orientation: "auto",
    cardWidthMm: 55,
    cardHeightMm: 85,
    gapMm: 2,
    marginMm: 5,
    cropMarks: true
  });
  const [sheetCards, setSheetCards] = useState<UploadedCard[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sheetFileInputRef = useRef<HTMLInputElement | null>(null);
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

  const sheetLayout = useMemo(() => resolveSheetLayout(sheetSettings), [sheetSettings]);
  const totalSheetPages = Math.max(
    1,
    sheetLayout.layout.cardsPerPage > 0 ? Math.ceil(sheetCards.length / sheetLayout.layout.cardsPerPage) : 1
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

  function updateSheetSetting(key: keyof SheetSettings, value: number | string | boolean) {
    setSheetSettings((current) => ({
      ...current,
      [key]: typeof value === "number" ? (key === "gapMm" ? Math.max(0, value) : Math.max(0.1, value)) : value
    }));
  }

  async function uploadSheetCards(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type === "image/png");
    if (files.length === 0) return;

    const cards = await Promise.all(files.map(readCardFile));
    setSheetCards((current) => [...current, ...cards]);
    event.target.value = "";
  }

  function removeSheetCard(id: string) {
    setSheetCards((current) => current.filter((card) => card.id !== id));
  }

  function moveSheetCard(id: string, direction: -1 | 1) {
    setSheetCards((current) => {
      const index = current.findIndex((card) => card.id === id);
      const nextIndex = index + direction;

      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [card] = next.splice(index, 1);
      next.splice(nextIndex, 0, card);
      return next;
    });
  }

  function exportPrintPdf() {
    if (sheetCards.length === 0 || sheetLayout.layout.cardsPerPage === 0) return;

    const { widthMm, heightMm, orientation, layout } = sheetLayout;
    const doc = new jsPDF({
      unit: "mm",
      format: [widthMm, heightMm],
      orientation
    });

    doc.setDrawColor(70, 70, 70);
    doc.setLineWidth(0.12);

    sheetCards.forEach((card, index) => {
      const slotIndex = index % layout.cardsPerPage;

      if (index > 0 && slotIndex === 0) {
        doc.addPage([widthMm, heightMm], orientation);
      }

      const slot = layout.positions[slotIndex];
      const placement = getImagePlacement(
        card.width,
        card.height,
        slot.x,
        slot.y,
        sheetSettings.cardWidthMm,
        sheetSettings.cardHeightMm
      );

      doc.addImage(card.dataUrl, "PNG", placement.x, placement.y, placement.width, placement.height, undefined, "NONE");

      if (sheetSettings.cropMarks) {
        drawPdfCropMarks(doc, slot.x, slot.y, sheetSettings.cardWidthMm, sheetSettings.cardHeightMm);
      }
    });

    doc.save(`photocard-print-sheet-${sheetCards.length}-cards.pdf`);
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
    <div className="app-frame">
      <nav className="mode-tabs" aria-label="App sections">
        <button
          type="button"
          className={activeTab === "editor" ? "active" : ""}
          onClick={() => setActiveTab("editor")}
        >
          Photocard Editor
        </button>
        <button
          type="button"
          className={activeTab === "sheet" ? "active" : ""}
          onClick={() => setActiveTab("sheet")}
        >
          Print Sheet Maker
        </button>
      </nav>

      {activeTab === "editor" ? (
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
      ) : (
      <main className="app-shell">
        <section className="control-panel" aria-label="Print sheet controls">
          <div>
            <p className="eyebrow">PDF layout tool</p>
            <h1>Print Sheet Maker</h1>
          </div>

          <input
            ref={sheetFileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/png"
            multiple
            onChange={uploadSheetCards}
          />

          <div className="button-row">
            <button type="button" className="primary-action" onClick={() => sheetFileInputRef.current?.click()}>
              <ImageUp size={18} aria-hidden="true" />
              Upload PNGs
            </button>
            <button type="button" onClick={exportPrintPdf} disabled={sheetCards.length === 0}>
              <FileText size={18} aria-hidden="true" />
              Export PDF
            </button>
          </div>

          <div className="status-strip">
            <span>{PAPER_SIZES[sheetSettings.paperSize].label} / {sheetLayout.orientation}</span>
            <strong>
              {sheetLayout.layout.columns} across x {sheetLayout.layout.rows} down
            </strong>
            <span>
              {sheetLayout.layout.cardsPerPage} cards per page / {totalSheetPages} page{totalSheetPages === 1 ? "" : "s"}
            </span>
          </div>

          <div className="select-grid">
            <label>
              Paper size
              <select
                value={sheetSettings.paperSize}
                onChange={(event) => updateSheetSetting("paperSize", event.target.value)}
              >
                <option value="a4">A4</option>
                <option value="letter">US Letter</option>
              </select>
            </label>
            <label>
              Orientation
              <select
                value={sheetSettings.orientation}
                onChange={(event) => updateSheetSetting("orientation", event.target.value)}
              >
                <option value="auto">Auto</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
          </div>

          <div className="size-grid two-column">
            <label>
              Card width mm
              <input
                type="number"
                min="1"
                step="0.1"
                value={sheetSettings.cardWidthMm}
                onChange={(event) => updateSheetSetting("cardWidthMm", Number(event.target.value))}
              />
            </label>
            <label>
              Card height mm
              <input
                type="number"
                min="1"
                step="0.1"
                value={sheetSettings.cardHeightMm}
                onChange={(event) => updateSheetSetting("cardHeightMm", Number(event.target.value))}
              />
            </label>
            <label>
              Gap mm
              <input
                type="number"
                min="0"
                step="0.1"
                value={sheetSettings.gapMm}
                onChange={(event) => updateSheetSetting("gapMm", Number(event.target.value))}
              />
            </label>
            <label>
              Margin mm
              <input
                type="number"
                min="0"
                step="0.1"
                value={sheetSettings.marginMm}
                onChange={(event) => updateSheetSetting("marginMm", Number(event.target.value))}
              />
            </label>
          </div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={sheetSettings.cropMarks}
              onChange={(event) => updateSheetSetting("cropMarks", event.target.checked)}
            />
            Crop marks / cut lines
          </label>

          <div className="print-note">Print at 100% / Actual Size. Do not use Fit to Page.</div>

          <div className="uploaded-list" aria-label="Uploaded photocards">
            {sheetCards.length === 0 ? (
              <p>No finished photocard PNGs uploaded yet.</p>
            ) : (
              sheetCards.map((card, index) => (
                <div className="uploaded-card" key={card.id}>
                  <img src={card.dataUrl} alt="" />
                  <div>
                    <strong>{card.name}</strong>
                    <span>{index + 1} / {sheetCards.length}</span>
                  </div>
                  <button type="button" aria-label={`Move ${card.name} up`} onClick={() => moveSheetCard(card.id, -1)}>
                    <ArrowUp size={16} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`Move ${card.name} down`} onClick={() => moveSheetCard(card.id, 1)}>
                    <ArrowDown size={16} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`Remove ${card.name}`} onClick={() => removeSheetCard(card.id)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="preview-stage" aria-label="Print sheet preview">
          <div className="preview-header">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>Page 1 sheet layout</h2>
            </div>
            <div className="preview-meta">
              {sheetLayout.widthMm} x {sheetLayout.heightMm} mm
            </div>
          </div>

          <div className="sheet-preview-wrap">
            <div
              className="paper-preview"
              style={{
                aspectRatio: `${sheetLayout.widthMm} / ${sheetLayout.heightMm}`
              }}
            >
              {sheetLayout.layout.positions.map((slot) => {
                const card = sheetCards[slot.index];

                return (
                  <div
                    className="sheet-slot"
                    key={slot.index}
                    style={{
                      left: `${(slot.x / sheetLayout.widthMm) * 100}%`,
                      top: `${(slot.y / sheetLayout.heightMm) * 100}%`,
                      width: `${(sheetSettings.cardWidthMm / sheetLayout.widthMm) * 100}%`,
                      height: `${(sheetSettings.cardHeightMm / sheetLayout.heightMm) * 100}%`
                    }}
                  >
                    {card ? <img src={card.dataUrl} alt={card.name} /> : <span>{slot.index + 1}</span>}
                    {sheetSettings.cropMarks ? <span className="crop-mark-preview" aria-hidden="true" /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
