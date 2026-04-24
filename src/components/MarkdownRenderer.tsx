import { useRef, useEffect, useState } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Master color palette — 12 colors per theme. Used for pie, cScale, xyChart, and auto-legends. */
export const PALETTE = {
  light: ['#b04a34','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#4f46e5',
          '#059669','#ea580c','#4338ca','#b91c1c'],
  dark:  ['#e39280','#4ade80','#fbbf24','#f87171','#a78bfa','#22d3ee','#f472b6','#818cf8',
          '#34d399','#fb923c','#a5b4fc','#fca5a5'],
} as const;

/** Derive pie1-12, cScale0-11 (+ label/peer), git0-7, fillType0-7 from PALETTE */
function paletteVars(theme: 'light' | 'dark') {
  const colors = PALETTE[theme];
  const labelColor = theme === 'dark' ? '#1e1b17' : '#ffffff';
  const vars: Record<string, string> = {};
  for (let i = 0; i < colors.length; i++) {
    vars[`pie${i + 1}`] = colors[i];
    vars[`cScale${i}`] = colors[i];
    vars[`cScaleLabel${i}`] = labelColor;
    vars[`cScalePeer${i}`] = colors[i];
  }
  // gitGraph branch colors (git0..7)
  for (let i = 0; i < 8; i++) {
    vars[`git${i}`] = colors[i % colors.length];
  }
  // fillType for journey/state (0..7)
  const fills = theme === 'light'
    ? ['#fbe4dc', '#f1ece2', '#dcfce7', '#fef3c7', '#fce7f3', '#e0e7ff', '#d1fae5', '#fff7ed']
    : ['#7a2d1e', '#3a352d', '#052e16', '#78350f', '#831843', '#312e81', '#064e3b', '#7c2d12'];
  for (let i = 0; i < fills.length; i++) {
    vars[`fillType${i}`] = fills[i];
  }
  return vars;
}

const MERMAID_THEME_VARS = {
  light: {
    primaryColor: '#fbe4dc',
    primaryTextColor: '#4a1a10',
    primaryBorderColor: '#b04a34',
    secondaryColor: '#f1ece2',
    secondaryTextColor: '#2a2520',
    secondaryBorderColor: '#8a857c',
    tertiaryColor: '#dcfce7',
    tertiaryTextColor: '#052e16',
    tertiaryBorderColor: '#16a34a',
    lineColor: '#8a857c',
    textColor: '#1e1b17',
    mainBkg: '#fbe4dc',
    nodeBorder: '#b04a34',
    clusterBkg: '#f3eee4',
    clusterBorder: '#d3cdc1',
    titleColor: '#4a1a10',
    edgeLabelBackground: '#ffffff',
    nodeTextColor: '#4a1a10',
    // Sequence diagram
    actorTextColor: '#4a1a10',
    actorBkg: '#fbe4dc',
    actorBorder: '#b04a34',
    actorLineColor: '#8a857c',
    signalColor: '#1e1b17',
    signalTextColor: '#1e1b17',
    labelBoxBkgColor: '#fbe4dc',
    labelBoxBorderColor: '#b04a34',
    labelTextColor: '#4a1a10',
    loopTextColor: '#4a1a10',
    noteBkgColor: '#f1ece2',
    noteTextColor: '#2a2520',
    noteBorderColor: '#8a857c',
    activationBkgColor: '#fbe4dc',
    activationBorderColor: '#b04a34',
    // Pie / timeline / cScale — generated from PALETTE
    ...paletteVars('light'),
    pieTitleTextColor: '#4a1a10',
    pieSectionTextColor: '#ffffff',
    pieLegendTextColor: '#1e1b17',
    pieStrokeColor: '#ffffff',
    // State / class
    labelColor: '#1e1b17',
    altBackground: '#f3eee4',
    // Flowchart
    defaultLinkColor: '#8a857c',
    // Mindmap
    mindmapRootColor: '#fbe4dc',
    mindmapTextColor: '#4a1a10',
    mindmapMainColor: '#b04a34',
    mindmapSecondaryColor: '#f1ece2',
    mindmapLineColor: '#8a857c',
    // Gantt
    sectionBkgColor: '#fbe4dc',
    sectionBkgColor2: '#f1ece2',
    altSectionBkgColor: '#f3eee4',
    taskBkgColor: '#fbe4dc',
    taskBorderColor: '#b04a34',
    taskTextColor: '#4a1a10',
    doneTaskBkgColor: '#dcfce7',
    critBkgColor: '#fef3c7',
    todayLineColor: '#dc2626',
  },
  dark: {
    primaryColor: '#7a2d1e',
    primaryTextColor: '#fbe4dc',
    primaryBorderColor: '#e39280',
    secondaryColor: '#3a352d',
    secondaryTextColor: '#ece6d8',
    secondaryBorderColor: '#8a857c',
    tertiaryColor: '#052e16',
    tertiaryTextColor: '#dcfce7',
    tertiaryBorderColor: '#4ade80',
    lineColor: '#8a857c',
    textColor: '#f2ecde',
    mainBkg: '#7a2d1e',
    nodeBorder: '#e39280',
    clusterBkg: '#1c1915',
    clusterBorder: '#3a352d',
    titleColor: '#fbe4dc',
    edgeLabelBackground: '#221e18',
    nodeTextColor: '#fbe4dc',
    // Sequence diagram
    actorTextColor: '#fbe4dc',
    actorBkg: '#7a2d1e',
    actorBorder: '#e39280',
    actorLineColor: '#8a857c',
    signalColor: '#f2ecde',
    signalTextColor: '#f2ecde',
    labelBoxBkgColor: '#7a2d1e',
    labelBoxBorderColor: '#e39280',
    labelTextColor: '#fbe4dc',
    loopTextColor: '#fbe4dc',
    noteBkgColor: '#3a352d',
    noteTextColor: '#ece6d8',
    noteBorderColor: '#8a857c',
    activationBkgColor: '#7a2d1e',
    activationBorderColor: '#e39280',
    // Pie / timeline / cScale — generated from PALETTE
    ...paletteVars('dark'),
    pieTitleTextColor: '#fbe4dc',
    pieSectionTextColor: '#1e1b17',
    pieLegendTextColor: '#f2ecde',
    pieStrokeColor: '#1c1915',
    // State / class
    labelColor: '#f2ecde',
    altBackground: '#221e18',
    // Flowchart
    defaultLinkColor: '#8a857c',
    // Mindmap
    mindmapRootColor: '#7a2d1e',
    mindmapTextColor: '#fbe4dc',
    mindmapMainColor: '#e39280',
    mindmapSecondaryColor: '#3a352d',
    mindmapLineColor: '#8a857c',
    // Gantt
    sectionBkgColor: '#7a2d1e',
    sectionBkgColor2: '#3a352d',
    altSectionBkgColor: '#1c1915',
    taskBkgColor: '#7a2d1e',
    taskBorderColor: '#e39280',
    taskTextColor: '#fbe4dc',
    doneTaskBkgColor: '#052e16',
    critBkgColor: '#78350f',
    todayLineColor: '#f87171',
  },
} as const;

/** Diagram types where cScale colors appear as node backgrounds (need muted fills). */
const CSCALE_AS_BG_RE = /^\s*(mindmap|timeline|kanban)/m;

/** Override cScale with muted background fills for diagrams that use cScale as node bg.
 *  Also sets cScaleInv (used by kanban for card backgrounds) to a dark surface color. */
function bgCScaleVars(theme: 'light' | 'dark'): Record<string, string> {
  const fills = NODE_FILLS[theme];
  const strokes = PALETTE[theme];
  const label = theme === 'dark' ? '#f2ecde' : '#1e1b17';
  const inv = theme === 'dark' ? '#221e18' : '#ffffff';
  const vars: Record<string, string> = {};
  for (let i = 0; i < 12; i++) {
    vars[`cScale${i}`] = fills[i % fills.length];
    vars[`cScalePeer${i}`] = strokes[i % strokes.length];
    vars[`cScaleLabel${i}`] = label;
    vars[`cScaleInv${i}`] = inv;
  }
  return vars;
}

function getMermaidConfig(theme: 'light' | 'dark', bgPalette = false) {
  return {
    startOnLoad: false,
    theme: 'base' as const,
    securityLevel: 'strict' as const,
    themeVariables: {
      ...MERMAID_THEME_VARS[theme],
      ...(bgPalette ? bgCScaleVars(theme) : {}),
      xyChart: {
        backgroundColor: theme === 'dark' ? '#1c1915' : '#f3eee4',
        plotColorPalette: PALETTE[theme].join(', '),
      },
    },
  };
}

let mermaidInitialized = false;
let renderCounter = 0;

function initMermaid(theme: 'light' | 'dark') {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaid.initialize(getMermaidConfig(theme));
}

// Custom renderer: turn ```mermaid blocks into <pre class="mermaid"> for mermaid.run()
const renderer = new marked.Renderer();
const origCode = renderer.code.bind(renderer);
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  if (lang === 'mermaid') {
    return `<pre class="mermaid">${text}</pre>`;
  }
  return origCode({ type: 'code', raw: text, text, lang });
};

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer,
});

// Override del tokenizer: require double tildes ~~text~~ only (not single ~text~)
marked.use({
  tokenizer: {
    del(src) {
      const match = src.match(/^~~(?=\S)([\s\S]*?\S)~~/);
      if (match) {
        return {
          type: 'del',
          raw: match[0],
          text: match[1],
          tokens: this.lexer.inlineTokens(match[1]),
        };
      }
      return undefined;
    },
  },
});

/** Render LaTeX math: $$...$$ (display) and $...$ (inline) → KaTeX HTML.
 *  Runs BEFORE marked so LaTeX doesn't get mangled by markdown parsing.
 *  Protects code/mermaid blocks from LaTeX processing. */
function renderLatex(md: string): string {
  // Protect fenced code blocks (```...```) from LaTeX processing
  const codeBlocks: string[] = [];
  let result = md.replace(/```[\s\S]*?```/g, (block) => {
    codeBlocks.push(block);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });
  // Also protect inline code (`...`)
  const inlineCode: string[] = [];
  result = result.replace(/`[^`]+`/g, (code) => {
    inlineCode.push(code);
    return `\x00INLINE${inlineCode.length - 1}\x00`;
  });

  // Display math: $$...$$ (can span multiple lines)
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<code class="katex-error">${tex.trim()}</code>`;
    }
  });
  // Inline math: $...$ (not empty, not starting/ending with space)
  result = result.replace(/(?<![\\$])\$(?!\s)((?:[^$\\]|\\.)+?)(?<!\s)\$/g, (_, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<code class="katex-error">${tex.trim()}</code>`;
    }
  });

  // Restore protected blocks
  result = result.replace(/\x00INLINE(\d+)\x00/g, (_, i) => inlineCode[parseInt(i)]);
  result = result.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);
  return result;
}

// DOMPurify config: allow MathML tags + attributes used by KaTeX
const PURIFY_CONFIG = {
  ADD_TAGS: ['math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt',
    'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace',
    'annotation', 'semantics', 'mpadded', 'mstyle', 'menclose', 'mroot',
    'mmultiscripts', 'mprescripts', 'none'],
  ADD_ATTR: ['xmlns', 'encoding', 'mathvariant', 'stretchy', 'fence', 'separator',
    'accent', 'accentunder', 'displaystyle', 'scriptlevel', 'lspace', 'rspace',
    'minsize', 'maxsize', 'movablelimits', 'symmetric', 'linethickness',
    'columnalign', 'rowalign', 'columnspacing', 'rowspacing',
    'width', 'height', 'depth', 'voffset',
    'aria-hidden', 'style'],
};

function useResolvedTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.theme as 'light' | 'dark') || 'light',
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const t = document.documentElement.dataset.theme as 'light' | 'dark';
      if (t) setTheme(t);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export function InlineMarkdown({ text }: { text: string }) {
  const html = DOMPurify.sanitize(marked.parseInline(renderLatex(text), { async: false }) as string, PURIFY_CONFIG);
  return <span class="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />;
}

interface MarkdownRendererProps {
  content: string;
}

// Extract raw mermaid source blocks from markdown before DOMPurify can modify them
export function extractMermaidSources(md: string): string[] {
  const sources: string[] = [];
  const re = /```mermaid\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    sources.push(m[1].replace(/\n$/, ''));
  }
  return sources;
}

/** Remove ```mermaid...``` blocks whose source matches any in the broken list, plus trailing legend lines. */
export function stripBrokenMermaidBlocks(md: string, brokenSources: string[]): string {
  if (brokenSources.length === 0) return md;
  let result = md;
  for (const source of brokenSources) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match the mermaid block + optional trailing blank line + legend line (colored squares/circles like 🟦 🟧 🟩 🔵 🟠 🟢)
    const re = new RegExp('```mermaid\\n' + escaped + '\\n```\\n*(?:[^\n]*[🟥🟧🟨🟩🟦🟪🟫⬜⬛🔴🟠🟡🟢🔵🟣🟤⚪⚫●][^\n]*\\n?)?', 'g');
    result = result.replace(re, '');
  }
  return result;
}

// Fix unlabeled mermaid code blocks: ```\nflowchart → ```mermaid\nflowchart
const MERMAID_KEYWORDS = 'flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitgraph|mindmap|timeline|sankey|xychart|block|packet|architecture|kanban';
const FIX_MERMAID_RE = new RegExp('```\\n((?:' + MERMAID_KEYWORDS + ')\\b)', 'g');
export function fixMermaidBlocks(md: string): string {
  return md.replace(FIX_MERMAID_RE, '```mermaid\n$1');
}

/**
 * Apply all mermaid syntax fixes to full markdown text.
 * Fixes ER-style arrows in classDiagram blocks so exported .md is also clean.
 */
export function fixMermaidSyntax(md: string): string {
  return md.replace(/```mermaid\n([\s\S]*?)```/g, (block, source: string) => {
    const fixed = fixClassDiagramRelations(source);
    return fixed === source ? block : '```mermaid\n' + fixed + '```';
  });
}

/** Parse xychart-beta series — returns array of {type, name} or null if <2 series. */
function parseXyChartSeries(source: string): { type: 'line' | 'bar'; name: string }[] | null {
  const re = /^\s*(line|bar)\s*(?:"([^"]*)")?\s*\[/gm;
  const series: { type: 'line' | 'bar'; name: string }[] = [];
  let m;
  let idx = 0;
  while ((m = re.exec(source)) !== null) {
    idx++;
    series.push({ type: m[1] as 'line' | 'bar', name: m[2] || `Series ${idx}` });
  }
  return series.length >= 2 ? series : null;
}

/** Node background fills — muted for dark mode, pastel for light mode. */
const NODE_FILLS = {
  light: ['#fbe4dc', '#dcfce7', '#fef3c7', '#fee2e2', '#f3e8ff', '#cffafe', '#fce7f3', '#e0e7ff'],
  dark:  ['#7a2d1e', '#052e16', '#78350f', '#7f1d1d', '#581c87', '#164e63', '#831843', '#312e81'],
} as const;

/** Replace fill/stroke/color in `style` and `classDef` with theme-appropriate colors.
 *  Preserves non-color props (stroke-width, stroke-dasharray, etc.). */
function themeInlineColors(source: string, theme: 'light' | 'dark'): string {
  const fills = NODE_FILLS[theme];
  const strokes = PALETTE[theme];
  const text = theme === 'dark' ? '#fbe4dc' : '#4a1a10';
  let idx = 0;
  return source.replace(
    /^(\s*(?:style|classDef)\s+\S+\s+)(.*)$/gm,
    (_, prefix: string, props: string) => {
      const i = idx++ % fills.length;
      const kept = props.split(',').map(p => p.trim())
        .filter(p => !/^(fill|stroke|color):/.test(p));
      const themed = [`fill:${fills[i]}`, `stroke:${strokes[i]}`, `color:${text}`, ...kept];
      return `${prefix}${themed.join(',')}`;
    },
  );
}

/**
 * Transform xychart-beta bar series for visual stacking.
 * Mermaid draws bars overlapping at the same x position (later series on top).
 * To create a stacked effect, each bar's values become the cumulative sum of
 * itself + all subsequent bar series. The first bar (at back) is tallest,
 * the last bar (in front) keeps its original values.
 */
function stackBarSeries(source: string): string {
  if (!source.match(/^\s*xychart-beta/m)) return source;

  // Collect bar lines with their values
  const barRe = /^(\s*bar\s*(?:"[^"]*")?\s*)\[([\d\s.,eE+-]+)\]/gm;
  const bars: { fullMatch: string; prefix: string; values: number[] }[] = [];
  let m;
  while ((m = barRe.exec(source)) !== null) {
    bars.push({
      fullMatch: m[0],
      prefix: m[1],
      values: m[2].split(',').map(v => parseFloat(v.trim())),
    });
  }
  if (bars.length < 2) return source;

  // Compute reverse cumulative: bar[i] += bar[i+1] + bar[i+2] + ...
  const len = bars[0].values.length;
  const cumulative = bars.map(b => [...b.values]);
  for (let i = bars.length - 2; i >= 0; i--) {
    for (let j = 0; j < len; j++) {
      cumulative[i][j] = (cumulative[i][j] || 0) + (cumulative[i + 1][j] || 0);
    }
  }

  // Replace values in source; also fix y-axis max if specified
  let result = source;
  for (let i = 0; i < bars.length; i++) {
    result = result.replace(bars[i].fullMatch, bars[i].prefix + '[' + cumulative[i].join(', ') + ']');
  }

  // Adjust y-axis max if explicitly set and cumulative total exceeds it
  const yAxisRe = /^(\s*y-axis\s+"[^"]*"\s+[\d.]+\s*-->\s*)([\d.]+)/m;
  const yMatch = result.match(yAxisRe);
  if (yMatch) {
    const currentMax = parseFloat(yMatch[2]);
    const stackMax = Math.max(...cumulative[0]);
    if (stackMax > currentMax) {
      result = result.replace(yAxisRe, '$1' + Math.ceil(stackMax * 1.1));
    }
  }

  return result;
}

/**
 * Fix ER-style relationship arrows in classDiagram.
 * LLMs frequently generate `||--o{`, `}|--|{` etc. which are erDiagram-only.
 * Replace with `-->` so the diagram renders instead of crashing.
 */
function fixClassDiagramRelations(source: string): string {
  if (!source.match(/^\s*classDiagram/m)) return source;
  // Match relationship lines where the arrow contains { or } (ER cardinality markers)
  return source.replace(
    /^(\s*\w+\s+)(\S*[{}]\S*)(\s+\w+\s*(?::.*)?$)/gm,
    '$1-->$3',
  );
}

/** Create a legend element for xychart-beta series. Uses inline styles for copy/paste survival. */
function createLegendElement(series: { type: 'line' | 'bar'; name: string }[], theme: 'light' | 'dark'): HTMLDivElement {
  const colors = PALETTE[theme];
  const legend = document.createElement('div');
  legend.className = 'mermaid-legend';
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const color = colors[i % colors.length];
    const item = document.createElement('span');
    item.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';
    const swatch = document.createElement('span');
    if (s.type === 'line') {
      swatch.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};`;
    } else {
      swatch.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};`;
    }
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(s.name));
    legend.appendChild(item);
  }
  return legend;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useResolvedTheme();
  const fixed = fixMermaidBlocks(content);
  const mermaidSources = extractMermaidSources(fixed);
  const html = DOMPurify.sanitize(marked.parse(renderLatex(fixed), { async: false }) as string, PURIFY_CONFIG);

  // Hide broken images gracefully (URLs may expire, especially social media thumbnails)
  useEffect(() => {
    if (!ref.current) return;
    const handleError = (e: Event) => {
      if (e.target instanceof HTMLImageElement) {
        const wrapper = e.target.closest('.dismissable-media');
        if (wrapper) (wrapper as HTMLElement).style.display = 'none';
        else e.target.style.display = 'none';
      }
    };
    // error events don't bubble — must use capture phase
    ref.current.addEventListener('error', handleError, true);
    return () => ref.current?.removeEventListener('error', handleError, true);
  }, [html]);

  useEffect(() => {
    if (!ref.current) return;
    const mermaidEls = ref.current.querySelectorAll<HTMLElement>('pre.mermaid');
    if (mermaidEls.length === 0) return;

    // Inject raw mermaid source directly from markdown (bypasses DOMPurify text mangling)
    for (let i = 0; i < mermaidEls.length; i++) {
      const el = mermaidEls[i];
      const source = mermaidSources[i] ?? el.dataset.source ?? el.textContent ?? '';
      el.removeAttribute('data-processed');
      el.textContent = source;
      el.dataset.source = source;
    }

    initMermaid(theme);
    mermaid.initialize(getMermaidConfig(theme));

    // Render each diagram individually for isolation and proper error display
    let cancelled = false;
    (async () => {
      for (let i = 0; i < mermaidEls.length; i++) {
        if (cancelled) return;
        const el = mermaidEls[i];
        const source = el.dataset.source || el.textContent || '';
        if (!source.trim()) continue;
        const renderId = `mermaid-${Date.now()}-${renderCounter++}`;
        const renderSource = themeInlineColors(fixClassDiagramRelations(stackBarSeries(source)), theme);
        const needsBgPalette = CSCALE_AS_BG_RE.test(source);
        if (needsBgPalette) mermaid.initialize(getMermaidConfig(theme, true));
        try {
          const { svg, bindFunctions } = await mermaid.render(renderId, renderSource);
          if (cancelled) return;
          el.innerHTML = svg;
          bindFunctions?.(el);
          // Add dismiss button
          if (!el.querySelector('.dismiss-media-btn')) {
            const btn = document.createElement('button');
            btn.className = 'dismiss-media-btn no-print';
            btn.textContent = '\u00d7';
            btn.title = 'Remove diagram';
            btn.setAttribute('aria-label', 'Remove diagram');
            btn.addEventListener('click', (e) => { e.stopPropagation(); el.remove(); });
            el.appendChild(btn);
          }
          // Auto-legend for xychart-beta (only type needing it — pie has built-in, others have visible labels)
          const xySeries = parseXyChartSeries(source);
          if (xySeries) {
            el.querySelector('.mermaid-legend')?.remove();
            el.appendChild(createLegendElement(xySeries, theme));
          }
        } catch (err) {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          el.dataset.error = msg;
          // Hide broken diagram entirely — autoFixMermaid handles recovery
          el.style.display = 'none';
          // Clean up orphaned mermaid render container
          document.getElementById('d' + renderId)?.remove();
        } finally {
          if (needsBgPalette) mermaid.initialize(getMermaidConfig(theme));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [html, theme]);

  // Add dismiss buttons to images
  useEffect(() => {
    if (!ref.current) return;
    ref.current.querySelectorAll<HTMLImageElement>('img').forEach(img => {
      if (img.style.display === 'none') return;
      if (img.closest('.dismissable-media')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'dismissable-media';
      img.parentNode!.insertBefore(wrapper, img);
      wrapper.appendChild(img);
      const btn = document.createElement('button');
      btn.className = 'dismiss-media-btn no-print';
      btn.textContent = '\u00d7';
      btn.title = 'Remove image';
      btn.setAttribute('aria-label', 'Remove image');
      btn.addEventListener('click', (e) => { e.stopPropagation(); wrapper.remove(); });
      wrapper.appendChild(btn);
    });
  }, [html]);

  return <div ref={ref} class="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />;
}
