"use client";

import Image from "next/image";
import React, { useMemo, useRef, useState } from "react";
import { transformMetroHtmlToStyledSvg } from "@/lib/opm/transformMetroHtml";
import { transformTrendRadarHtmlToStyledSvg } from "@/lib/radar/transformTrendRadarHtml";

const SVG_NS = "http://www.w3.org/2000/svg";

export function OpportunityMapWorkspace() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rawHtml, setRawHtml] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [hasSvg, setHasSvg] = useState(false);

  const canProcess = useMemo(() => rawHtml.trim().length > 0, [rawHtml]);

  const lockFitRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);

  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const draggingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  function applyTransform(nextTx = tx, nextTy = ty, nextScale = scale) {
    const group = gRef.current;
    if (!group) return;
    group.setAttribute("transform", `translate(${nextTx} ${nextTy}) scale(${nextScale})`);
  }

  function ensureViewportGroup(svg: SVGSVGElement) {
    let group = svg.querySelector("#viewport-group") as SVGGElement | null;
    if (group) return group;

    group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("id", "viewport-group");

    while (svg.firstChild) {
      group.appendChild(svg.firstChild);
    }

    svg.appendChild(group);
    return group;
  }

  function fitToView() {
    const viewport = viewportRef.current;
    const svg = svgRef.current;
    const group = gRef.current;
    if (!viewport || !svg || !group) return;

    let x = 0;
    let y = 0;
    let width = 0;
    let height = 0;

    const viewBox = svg.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      x = viewBox.x;
      y = viewBox.y;
      width = viewBox.width;
      height = viewBox.height;
    } else {
      const box = group.getBBox();
      x = box.x;
      y = box.y;
      width = box.width;
      height = box.height;
    }

    if (!(width > 0 && height > 0)) return;

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (!(viewportWidth > 0 && viewportHeight > 0)) return;

    const paddingPx = 32;
    const fitScale = Math.min(
      (viewportWidth - paddingPx * 2) / width,
      (viewportHeight - paddingPx * 2) / height,
    );

    if (!Number.isFinite(fitScale) || fitScale <= 0) return;

    const nextTx = (viewportWidth / fitScale - width) / 2 - x;
    const nextTy = (viewportHeight / fitScale - height) / 2 - y;

    setScale(fitScale);
    setTx(nextTx);
    setTy(nextTy);
    applyTransform(nextTx, nextTy, fitScale);
  }

  function zoomBy(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (!(viewportWidth > 0 && viewportHeight > 0)) return;

    const nextScale = clamp(Math.round(scale * factor * 100) / 100, 0.2, 6);
    const screenCx = viewportWidth / 2;
    const screenCy = viewportHeight / 2;
    const svgCx = screenCx / scale - tx;
    const svgCy = screenCy / scale - ty;
    const nextTx = screenCx / nextScale - svgCx;
    const nextTy = screenCy / nextScale - svgCy;

    setScale(nextScale);
    setTx(nextTx);
    setTy(nextTy);
    applyTransform(nextTx, nextTy, nextScale);
  }

  async function renderSvgFromHtml(html: string, name?: string) {
    const result = await transformMetroHtmlToStyledSvg(html);

    setWarnings(result.warnings);
    if (name) setFileName(name);

    const host = svgHostRef.current;
    if (!host) return;

    host.innerHTML = "";
    svgRef.current = null;
    gRef.current = null;
    setHasSvg(false);
    if (!result.svg) return;

    const parsed = new DOMParser().parseFromString(result.svg, "image/svg+xml");
    const svg = parsed.querySelector("svg") as SVGSVGElement | null;

    if (!svg) {
      setWarnings((current) => [...current, "Parsed output did not contain an <svg> root."]);
      return;
    }

    host.appendChild(document.importNode(svg, true));

    const insertedSvg = host.querySelector("svg") as SVGSVGElement | null;
    if (!insertedSvg) return;

    svgRef.current = insertedSvg;
    gRef.current = ensureViewportGroup(insertedSvg);
    setHasSvg(true);
    lockFitRef.current = false;

    requestAnimationFrame(() => {
      if (lockFitRef.current) return;
      fitToView();
      lockFitRef.current = true;
    });
  }

  async function onProcess() {
    await renderSvgFromHtml(rawHtml);
  }

  async function onFilePicked(file: File | null) {
    if (!file) return;

    const text = await file.text();
    setRawHtml(text);
    await renderSvgFromHtml(text, file.name);
  }

  function downloadSvg() {
    const svg = svgRef.current;
    if (!svg) return;

    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "opportunity-map.svg";
    link.click();
    URL.revokeObjectURL(url);
  }

  const zoomIn = () => zoomBy(1.25);
  const zoomOut = () => zoomBy(1 / 1.25);
  const resetView = () => fitToView();

  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    draggingRef.current = true;
    lastRef.current = { x: event.clientX, y: event.clientY };
  };

  const onMouseMove = (event: React.MouseEvent) => {
    if (!draggingRef.current) return;

    const dxPx = event.clientX - lastRef.current.x;
    const dyPx = event.clientY - lastRef.current.y;
    lastRef.current = { x: event.clientX, y: event.clientY };

    const panSpeed = 1;
    const dxSvg = (dxPx / scale) * (1 + (scale - 1) * 0.9) * panSpeed;
    const dySvg = (dyPx / scale) * (1 + (scale - 1) * 0.9) * panSpeed;
    const nextTx = tx + dxSvg;
    const nextTy = ty + dySvg;

    setTx(nextTx);
    setTy(nextTy);
    applyTransform(nextTx, nextTy, scale);
  };

  const endDrag = () => {
    draggingRef.current = false;
  };

  const onWheelCapture = (event: React.WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      <style>{`
        .opm-viewport{
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          touch-action: none;
          user-select: none;
          cursor: grab;
          border-radius: 16px;
          background: white;
        }
        .opm-viewport:active{ cursor: grabbing; }
        .zoom-pill{
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items:flex-start;
          padding:4px;
          gap:4px;
          position:absolute;
          width:48px;
          height:92px;
          right:18px;
          top:50%;
          transform:translateY(-50%);
          background:#F6F6F6;
          box-shadow:2px 2px 4px rgba(0,0,0,0.1);
          border-radius:50px;
          z-index:30;
        }
        .zoom-btn{
          width:40px;
          height:40px;
          border-radius:999px;
          border:0;
          background:transparent;
          display:flex;
          align-items:center;
          justify-content:center;
          cursor:pointer;
        }
        .zoom-btn:hover{ background: rgba(0,0,0,0.05); }
        .zoom-btn:active{ transform: scale(0.98); }
        .zoom-btn img{
          width:22px;
          height:22px;
          display:block;
          pointer-events:none;
        }
        .zoom-plus{
          background:#0b0f14;
        }
        .zoom-plus img{
          filter: invert(1);
        }
        .opm-viewport svg{
          shape-rendering: geometricPrecision;
          text-rendering: geometricPrecision;
        }
      `}</style>

      <div
        className={
          sidebarOpen
            ? "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
            : "grid grid-cols-1 gap-6"
        }
      >
        <section className="min-w-0 rounded-[32px] bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-gray-900">Opportunity Map Preview</h1>

            <div className="flex items-center gap-3">
              <div className="hidden text-xs text-gray-600 md:block">
                {fileName ? `Loaded: ${fileName}` : "No file loaded"}
              </div>

              <button
                type="button"
                onClick={() => setSidebarOpen((current) => !current)}
                className="rounded-full border border-[#d2d2d2] bg-white px-5 py-3 text-sm font-semibold text-[#2a2a2a] transition hover:bg-[#f6f6f6]"
                title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              >
                {sidebarOpen ? "Hide panel" : "Show panel"}
              </button>
            </div>
          </div>

          <div className="rounded-[28px] bg-[#f7f7f4] p-3">
            <div className="h-[72vh] overflow-hidden rounded-[24px] bg-white p-3">
              <div
                ref={viewportRef}
                className="opm-viewport"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={endDrag}
                onWheelCapture={onWheelCapture}
              >
                <div className="zoom-pill" aria-label="Zoom controls">
                  <button
                    type="button"
                    className="zoom-btn zoom-plus"
                    onClick={zoomIn}
                    onMouseDown={(event) => event.stopPropagation()}
                    aria-label="Zoom in"
                  >
                    <Image src="/zoom-plus.svg" alt="" width={22} height={22} />
                  </button>

                  <button
                    type="button"
                    className="zoom-btn"
                    onClick={zoomOut}
                    onMouseDown={(event) => event.stopPropagation()}
                    aria-label="Zoom out"
                  >
                    <Image src="/zoom-minus.svg" alt="" width={22} height={22} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    resetView();
                  }}
                  className="absolute bottom-4 right-4 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50"
                  aria-label="Reset view"
                >
                  Reset
                </button>

                <div ref={svgHostRef} className="h-full w-full" />
              </div>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">Warnings</div>
              <ul className="mt-1 list-disc pl-5">
                {warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {sidebarOpen && (
          <aside className="rounded-[32px] bg-[#f3f3f1] p-10 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
            <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-[#202020]">Customize map</h2>
            <p className="mt-5 text-sm leading-6 text-[#7b7b7b]">
              MVP: upload your unstyled HTML (like{" "}
              <code className="rounded bg-white px-1 py-0.5 text-[#444]">metro_map_all_labels_interactive.html</code>), then
              we render a styled SVG.
            </p>

            <div className="mt-12">
              <label className="mb-4 block text-sm font-medium text-[#4a4a4a]">Upload bubble HTML</label>
              <input
                type="file"
                accept=".html,text/html"
                className="block w-full rounded-full border border-[#d8d8d8] bg-white px-4 py-4 text-sm text-gray-900 file:mr-4 file:rounded-full file:border-0 file:bg-[#1f1f1f] file:px-5 file:py-3 file:text-sm file:font-semibold file:text-white hover:file:bg-black"
                onChange={(event) => onFilePicked(event.target.files?.[0] ?? null)}
              />
            </div>

            <div className="mt-12">
              <label className="mb-4 block text-sm font-medium text-[#4a4a4a]">Or paste HTML</label>
              <textarea
                value={rawHtml}
                onChange={(event) => setRawHtml(event.target.value)}
                className="h-40 w-full rounded-[24px] border border-[#d8d8d8] bg-white p-4 text-sm text-gray-900 placeholder:text-[#a1a1a1]"
                placeholder="Paste the full metro_map HTML here…"
              />
            </div>

            <button
              type="button"
              onClick={onProcess}
              disabled={!canProcess}
              className="mt-6 w-full rounded-full bg-[#1f1f1f] px-5 py-4 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              Process
            </button>

            <div className="mt-6 grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={downloadSvg}
                disabled={!hasSvg}
                className="w-full rounded-full border border-[#cfcfcf] bg-white px-5 py-4 text-sm font-semibold text-[#1f1f1f] transition hover:bg-[#f7f7f4] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download SVG
              </button>

              <button
                type="button"
                disabled
                className="w-full rounded-full border border-[#e4e4e4] bg-[#fafafa] px-5 py-4 text-sm font-semibold text-[#9d9d9d]"
                title="Next MVP step"
              >
                Download full HTML (next)
              </button>

              <button
                type="button"
                disabled
                className="w-full rounded-full border border-[#e4e4e4] bg-[#fafafa] px-5 py-4 text-sm font-semibold text-[#9d9d9d]"
                title="Next MVP step"
              >
                Download WP code (next)
              </button>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
