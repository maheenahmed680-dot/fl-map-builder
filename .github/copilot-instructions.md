# Copilot Instructions for fl-map-builder

## Project Overview
**fl-map-builder** is a Next.js application that transforms HTML-exported metro/opportunity maps into styled, interactive SVGs. Users upload HTML files containing unstyled SVG maps, and the system applies custom styling, bubble graphics, gradients, and security sanitization.

**Tech Stack**: Next.js 16, React 19, TypeScript (strict), Tailwind CSS v4, ESLint

## Core Architecture

### Data Flow
```
User uploads HTML → transformMetroHtmlToStyledSvg() → DOMParser clone
  → inject bubbles/gradients/styles → serialize to string → return SVG + warnings
  → dangerouslySetInnerHTML in preview
```

### Key Files
- **lib/opm/transformMetroHtml.ts**: Core transformation engine
- **app/opportunity-map/page.tsx**: Upload + preview UI
- **public/bubbles/**: Bubble SVG assets

## Critical Patterns & Conventions

### 1. SVG Transformation Pipeline
The transformation process is **order-dependent**:
1. Parse HTML with DOMParser (not DOM API)
2. Clone SVG element to isolate changes
3. Strip scripts/event handlers for security
4. Inject bubble symbols into `<defs>` (fetch from `/bubbles/`)
5. Apply gradients, filters, CSS styling
6. Return serialized string + warnings array

**Important**: Always use `document.createElementNS("http://www.w3.org/2000/svg", "element")` for SVG creation, not `createElement()`.

### 2. Color Mapping System
- **STROKE_TO_BUBBLE**: Maps hex stroke colors → bubble names (e.g., `"#A5D6ED" → "blue"`)
- **BUBBLE_FILES**: Maps names → public paths (e.g., `blue → "/bubbles/bubble-blue.svg"`)
- When processing `g.node.single` elements, extract stroke color and look up bubble name

### 3. Gradient & Color Blending
- Helper functions: `hexToRgb()`, `mix()`, `rgbStr()`
- Radial gradients use 9-stop color progression (20% increments blend white→base→deep black)
- Current implementation: single green gradient (`#bce39e`) for all bubbles; design allows per-color gradients

### 4. Security Sanitization
- **Always strip scripts**: `querySelectorAll("script").forEach(n => n.remove())`
- **Always strip event handlers**: attributes starting with `on` (onclick, onmouseover, etc.)
- Applied to both original parsed doc and cloned SVG before serialization
- Safety note: `dangerouslySetInnerHTML` is acceptable ONLY after sanitization

### 5. SVG Structure Expectations
- Input HTML has `<svg id="metro-svg">` or fallback first `<svg>`
- Expected node classes: `g.node.single` (leaf bubbles) and `g.node.intersection` (hubs)
- Expected edges: `g.edge` lines with stroke colors
- Expected legend: `#legend .legend-item line` for color→actor mapping (fallback: hardcoded colors)

## Development Commands
- `npm run dev`: Start dev server on localhost:3000 (auto-reload)
- `npm run build`: Production build (checks TypeScript strict mode)
- `npm run lint`: Run ESLint (uses Next.js + core-web-vitals config)

**Route**: `/opportunity-map` is the main feature page

## AI Agent Guidance

### When Adding Features
- **New bubble colors**: Add to BUBBLE_FILES, STROKE_TO_BUBBLE, and create `/bubbles/bubble-{name}.svg`
- **New SVG elements**: Use `document.createElementNS()` with http://www.w3.org/2000/svg namespace
- **Gradient customization**: Modify `ensureRadialGradient()` function; maintain 9-stop pattern for smooth fills
- **Input validation**: Check for missing viewBox with warning (don't fail silently)

### When Debugging
- Check if SVG viewBox is present (affects zoom/pan later)
- Verify stroke colors in map match STROKE_TO_BUBBLE keys (lowercase hex)
- Confirm `/bubbles/` SVGs are valid and readable from public folder
- Remember: DOMParser requires full document (not fragment); use `parseFromString(html, "text/html")`

### TypeScript Usage
- Strict mode enabled (`"strict": true` in tsconfig)
- Cast SVG elements explicitly: `as SVGCircleElement` not `as any`
- Return types explicitly in async functions: `Promise<TransformResult>`
- Union types for DOM queries: `Element | null` after `querySelector`, narrow before use

### Next.js & React Patterns
- Use `"use client"` directive for components with event listeners (OpportunityMapPage does)
- `useMemo()` for expensive calculations (e.g., `canProcess` button state)
- Tailwind v4: use utility classes directly; no custom CSS except SVG `<style>` injection
- Path alias `@/` → workspace root (configured in tsconfig)

## Future Considerations (from comments in code)
- Hub nodes (`.node.intersection`) are prepared but label logic deferred ("for later")
- Actor mapping exists but unused (color→actor index from legend)
- Pan/zoom UI is MVP focus; full drag interaction noted as "next"
- Download options "Download full HTML" and "Download WP code" marked disabled (next MVP)
