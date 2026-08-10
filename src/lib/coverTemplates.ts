// Original, code-generated cover art for events & competitions.
// No stock photography — every template is an abstract SVG composition built
// from our brand palette (pink / violet / amber / sky + neutrals).
// Templates are rendered live as SVG and rasterised to 1200x1200 PNG on select.

export type CoverCategory =
  | 'Tech'
  | 'Music'
  | 'Business'
  | 'Wellness'
  | 'Party'
  | 'Art & Design'
  | 'Food & Drink'
  | 'Sports'
  | 'Community';

export const COVER_CATEGORIES: CoverCategory[] = [
  'Tech', 'Music', 'Business', 'Wellness', 'Party', 'Art & Design', 'Food & Drink', 'Sports', 'Community',
];

type Style = 'mesh' | 'blobs' | 'halftone' | 'waves' | 'geo' | 'arcs';

export interface Palette {
  a: string; // primary
  b: string; // secondary
  bg: string; // backdrop
  ink: string; // text colour
}

const P = {
  pinkViolet: { a: '#ec1cb4', b: '#7c3aed', bg: '#160c22', ink: '#ffffff' },
  violetSky: { a: '#7c3aed', b: '#0ea5e9', bg: '#0b1226', ink: '#ffffff' },
  skyMint: { a: '#0ea5e9', b: '#22d3ee', bg: '#04202b', ink: '#ffffff' },
  amberPink: { a: '#f59e0b', b: '#ec1cb4', bg: '#221206', ink: '#ffffff' },
  amberCream: { a: '#f59e0b', b: '#fb7185', bg: '#fdf6ec', ink: '#3b2405' },
  pinkCream: { a: '#ec1cb4', b: '#7c3aed', bg: '#fbf1f8', ink: '#3b0b31' },
  slate: { a: '#334155', b: '#0ea5e9', bg: '#f1f5f9', ink: '#0f172a' },
  ink: { a: '#ec1cb4', b: '#f59e0b', bg: '#0a0a0a', ink: '#ffffff' },
  moss: { a: '#10b981', b: '#0ea5e9', bg: '#052e26', ink: '#ffffff' },
  blush: { a: '#fb7185', b: '#f59e0b', bg: '#fff5f5', ink: '#4c0519' },
} satisfies Record<string, Palette>;

export interface CoverTemplate {
  id: string;
  category: CoverCategory;
  style: Style;
  palette: Palette;
  seed: number;
}

const RECIPES: Record<CoverCategory, Array<[Style, Palette]>> = {
  Tech: [['mesh', P.violetSky], ['geo', P.ink], ['waves', P.skyMint], ['halftone', P.pinkViolet]],
  Music: [['blobs', P.pinkViolet], ['arcs', P.ink], ['mesh', P.amberPink], ['halftone', P.violetSky]],
  Business: [['geo', P.slate], ['waves', P.slate], ['mesh', P.violetSky], ['arcs', P.pinkCream]],
  Wellness: [['blobs', P.moss], ['waves', P.moss], ['mesh', P.skyMint], ['arcs', P.blush]],
  Party: [['blobs', P.pinkViolet], ['halftone', P.ink], ['mesh', P.pinkViolet], ['geo', P.amberPink]],
  'Art & Design': [['geo', P.pinkCream], ['arcs', P.amberCream], ['halftone', P.blush], ['blobs', P.amberPink]],
  'Food & Drink': [['blobs', P.amberCream], ['arcs', P.blush], ['halftone', P.amberPink], ['mesh', P.amberCream]],
  Sports: [['waves', P.ink], ['geo', P.skyMint], ['arcs', P.violetSky], ['mesh', P.moss]],
  Community: [['blobs', P.blush], ['mesh', P.pinkCream], ['geo', P.moss], ['waves', P.pinkCream]],
};

export const COVER_TEMPLATES: CoverTemplate[] = COVER_CATEGORIES.flatMap((category) =>
  RECIPES[category].map(([style, palette], i) => ({
    id: `${category.toLowerCase().replace(/[^a-z]+/g, '-')}-${style}-${i + 1}`,
    category,
    style,
    palette,
    seed: (category.length * 37 + i * 101 + style.length * 13) % 997,
  }))
);

/** Tiny deterministic PRNG so a template always renders identically. */
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function monogramOf(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const S = 1200; // canvas is square 1:1

function grain(id: string) {
  return `<filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`;
}

function body(t: CoverTemplate): string {
  const r = rng(t.seed);
  const { a, b } = t.palette;

  switch (t.style) {
    case 'mesh': {
      const blobs = Array.from({ length: 5 }, (_, i) => {
        const cx = 150 + r() * 900;
        const cy = 150 + r() * 900;
        const rad = 260 + r() * 320;
        return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" fill="url(#g${i % 2})" opacity="0.55"/>`;
      }).join('');
      return `<g filter="url(#soft)">${blobs}</g>`;
    }
    case 'blobs': {
      const shapes = Array.from({ length: 4 }, (_, i) => {
        const cx = 220 + r() * 760;
        const cy = 220 + r() * 760;
        const rx = 180 + r() * 220;
        const ry = 150 + r() * 240;
        const rot = (r() * 180).toFixed(0);
        return `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${i % 2 ? b : a}" opacity="0.72" transform="rotate(${rot} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`;
      }).join('');
      return `<g style="mix-blend-mode:multiply" filter="url(#soft)">${shapes}</g>`;
    }
    case 'halftone': {
      const dots: string[] = [];
      const step = 46;
      for (let y = step; y < S; y += step) {
        for (let x = step; x < S; x += step) {
          const d = Math.hypot(x - S * 0.62, y - S * 0.4) / (S * 0.8);
          const rad = Math.max(0, (1 - d) * 17);
          if (rad > 0.6) dots.push(`<circle cx="${x}" cy="${y}" r="${rad.toFixed(1)}" fill="${x + y > S ? b : a}" opacity="0.85"/>`);
        }
      }
      return `<circle cx="${S * 0.66}" cy="${S * 0.34}" r="300" fill="${a}" opacity="0.16"/>${dots.join('')}`;
    }
    case 'waves': {
      const lines = Array.from({ length: 26 }, (_, i) => {
        const y = 90 + i * 42;
        const amp = 40 + r() * 60;
        return `<path d="M -50 ${y} C ${S * 0.25} ${y - amp}, ${S * 0.6} ${y + amp}, ${S + 50} ${y - amp / 2}" fill="none" stroke="${i % 3 === 0 ? b : a}" stroke-width="${(3 + r() * 5).toFixed(1)}" opacity="0.6" stroke-linecap="round"/>`;
      }).join('');
      return lines;
    }
    case 'geo': {
      const parts: string[] = [];
      parts.push(`<rect x="0" y="${S * 0.58}" width="${S}" height="${S * 0.42}" fill="${a}" opacity="0.9"/>`);
      parts.push(`<circle cx="${S * 0.74}" cy="${S * 0.34}" r="210" fill="${b}" opacity="0.9"/>`);
      parts.push(`<rect x="${S * 0.1}" y="${S * 0.16}" width="240" height="240" fill="none" stroke="${b}" stroke-width="14" opacity="0.8"/>`);
      parts.push(`<path d="M ${S * 0.12} ${S * 0.86} L ${S * 0.34} ${S * 0.62} L ${S * 0.56} ${S * 0.86} Z" fill="${t.palette.bg}" opacity="0.35"/>`);
      return parts.join('');
    }
    case 'arcs': {
      const arcs = Array.from({ length: 7 }, (_, i) => {
        const rad = 160 + i * 110;
        return `<circle cx="${S * 0.18}" cy="${S * 0.88}" r="${rad}" fill="none" stroke="${i % 2 ? a : b}" stroke-width="${(10 + r() * 14).toFixed(0)}" opacity="0.7"/>`;
      }).join('');
      return `<g>${arcs}</g>`;
    }
  }
}

export interface CoverRenderOptions {
  /** Optional monogram / short label baked into the art (kept minimal, centred). */
  label?: string;
  /** Optional small caption under the monogram. */
  caption?: string;
}

/** Returns a complete, self-contained 1200x1200 SVG string. */
export function renderCoverSvg(t: CoverTemplate, opts: CoverRenderOptions = {}): string {
  const { a, b, bg, ink } = t.palette;
  const label = (opts.label ?? '').trim();
  const caption = (opts.caption ?? '').trim().slice(0, 28);

  const typo = label
    ? `<g>
        <circle cx="${S / 2}" cy="${caption ? S * 0.47 : S / 2}" r="200" fill="${bg}" opacity="0.55"/>
        <text x="${S / 2}" y="${caption ? S * 0.47 : S / 2}" text-anchor="middle" dominant-baseline="central"
          font-family="Georgia, 'Times New Roman', serif" font-size="230" font-weight="700" fill="${ink}"
          letter-spacing="6">${esc(label.slice(0, 2))}</text>
        ${caption ? `<text x="${S / 2}" y="${S * 0.68}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="42" font-weight="600" letter-spacing="10" fill="${ink}" opacity="0.85">${esc(caption.toUpperCase())}</text>` : ''}
      </g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="g0" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <linearGradient id="g1" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="70"/></filter>
    ${grain('grain')}
  </defs>
  <rect width="${S}" height="${S}" fill="${bg}"/>
  ${body(t)}
  ${typo}
  <rect width="${S}" height="${S}" filter="url(#grain)" opacity="0.06"/>
</svg>`;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Deterministically pick a template from a name — used by "Generate from name". */
export function templateForName(name: string): CoverTemplate {
  let h = 0;
  for (const ch of name || 'event') h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return COVER_TEMPLATES[h % COVER_TEMPLATES.length];
}

/** Rasterise an SVG string to a 1200x1200 PNG blob in the browser. */
export function svgToPngBlob(svg: string, size = S): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not supported'));
      ctx.drawImage(img, 0, 0, size, size);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not render image'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not render template'));
    img.src = svgDataUrl(svg);
  });
}
