/** Per-diagram-type documentation files, imported as raw strings. */
const docFiles = import.meta.glob('./mermaid-docs/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** Essential mermaid syntax rules — always included in LLM prompts. */
export const MERMAID_ESSENTIAL_RULES = `## MERMAID SYNTAX RULES
- Every diagram starts with a **type declaration** (e.g. \`flowchart LR\`, \`sequenceDiagram\`)
- The word \`end\` in lowercase breaks parsers — use \`"end"\`, \`(end)\`, \`[end]\`, or \`End\`
- Wrap special characters in \`"double quotes"\` or use HTML entities (\`#amp;\` \`#lt;\` \`#gt;\` \`#35;\`)
- Line breaks in labels: use \`<br>\` or \`<br/>\`
- Do NOT use escaped quotes (\\") inside node labels — use \`<br>\` for line breaks, \`<b>\`/\`<i>\` for formatting
- Node IDs must be ONLY letters or digits (A, B, C1, node1) — NO colons, dashes, dots, spaces, or special characters in IDs
- ALL display text goes inside brackets: A["Label with special:chars"], B{"Decision?"}
- Edge labels use |label| syntax. Always use \`flowchart TD\` or \`flowchart LR\`, never \`graph\`
- All diagrams MUST use \`\`\`mermaid fenced code blocks
- Do NOT nest matching delimiters in labels — \`A(foo(bar))\` and \`A[a[b]]\` break. Use quotes: \`A["foo(bar)"]\`
- Use \`stateDiagram-v2\` (not \`stateDiagram\`) — v1 is deprecated and has different syntax
- Frontmatter \`---\` must be the absolute first line — no whitespace, comments, or blank lines above it

## COMMON PITFALLS
1. **\`end\` keyword** — Never use lowercase \`end\` as node text. Wrap: \`"end"\`, \`End\`, \`[end]\`
2. **Leading \`o\` or \`x\`** in flowchart nodes — \`A---oB\` creates circle edge, not node "oB"
3. **Missing colons** in ER diagrams — all three parts required: \`ENTITY1 ||--o{ ENTITY2 : "label"\`
4. **Quotes around spaces** — Node names with spaces need \`"double quotes"\` in ER diagrams
5. **\`{}\` in comments** — Avoid curly braces inside \`%%\` comments; they confuse the parser
6. **Semicolons** in sequence diagram messages — Use \`#59;\` to escape
7. **Tab indentation** in mindmaps — Use spaces only
8. **Escaped quotes in JSON** — When diagram is inside a JSON string, \`\\"\` becomes \`"\` which breaks node labels like \`["text"]\`. Use \`<b>text</b>\` or parentheses \`(text)\` instead
9. **Subgraph direction ignored** — When nodes inside a subgraph link to nodes outside it, the subgraph \`direction\` is silently overridden by the parent
10. **Pie values must be positive** — Zero or negative values cause silent errors
11. **Duplicate node IDs with different shapes** — \`A[rect]\` then \`A(round)\` causes unpredictable rendering. Define shape once, reference by ID after

## WHICH DIAGRAM TYPE TO USE
| Need | Diagram Type |
|------|-------------|
| Process flow / algorithm | \`flowchart\` |
| API call sequence / protocol | \`sequenceDiagram\` |
| Sequence diagrams (alt syntax) | \`zenuml\` |
| OOP / system structure | \`classDiagram\` |
| State machine / lifecycle | \`stateDiagram-v2\` |
| Database schema | \`erDiagram\` |
| Requirements tracing | \`requirementDiagram\` |
| Project timeline / schedule | \`gantt\` |
| Distribution / proportions | \`pie\` |
| Brainstorming / hierarchy | \`mindmap\` |
| Historical timeline | \`timeline\` |
| Git branch strategy | \`gitGraph\` |
| UX user flow satisfaction | \`journey\` |
| 2D comparison matrix | \`quadrantChart\` |
| Line/bar charts | \`xychart-beta\` |
| Flow / energy diagrams | \`sankey-beta\` |
| Block diagrams | \`block-beta\` |
| Network packet structure | \`packet-beta\` |
| Kanban boards | \`kanban\` |
| Cloud / infra architecture | \`architecture-beta\` |
| Radar / spider charts | \`radar-beta\` |
| Hierarchical proportions | \`treemap-beta\` |
| C4 architecture model | \`C4Context\` / \`C4Container\` / \`C4Component\` / \`C4Deployment\` |

## MERMAID COLORS & LEGENDS
- Do NOT add YAML frontmatter with config/theme/themeVariables — colors are applied automatically.
- Do NOT add emoji legend lines (🟦 🟧 etc.) below diagrams — legends are generated automatically.
- For flowchart node styling, classDef in diagram body is still allowed.`;

/**
 * Map from mermaid diagram keyword → raw doc content.
 * Built from individual files in mermaid-docs/.
 */
export const mermaidDocSections: Record<string, string> = /* @__PURE__ */ (() => {
  // Map from filename (without extension) → mermaid source keywords
  const fileToKeywords: Record<string, string[]> = {
    flowchart: ['flowchart', 'graph'],
    sequenceDiagram: ['sequenceDiagram'],
    classDiagram: ['classDiagram'],
    stateDiagram: ['stateDiagram', 'stateDiagram-v2'],
    entityRelationshipDiagram: ['erDiagram'],
    gantt: ['gantt'],
    pie: ['pie'],
    mindmap: ['mindmap'],
    timeline: ['timeline'],
    gitgraph: ['gitGraph'],
    userJourney: ['journey'],
    quadrantChart: ['quadrantChart'],
    xyChart: ['xychart-beta'],
    sankey: ['sankey-beta'],
    block: ['block-beta'],
    packet: ['packet-beta'],
    kanban: ['kanban'],
    architecture: ['architecture-beta'],
    radar: ['radar-beta'],
    treemap: ['treemap-beta'],
    c4: ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'],
    requirementDiagram: ['requirementDiagram'],
    zenuml: ['zenuml'],
  };

  const sections: Record<string, string> = {};
  for (const [path, content] of Object.entries(docFiles)) {
    // path looks like "./mermaid-docs/flowchart.md"
    const filename = path.split('/').pop()?.replace('.md', '') ?? '';
    const keywords = fileToKeywords[filename];
    if (keywords) {
      for (const kw of keywords) sections[kw] = content;
    }
  }
  return sections;
})();

/** All mermaid doc files keyed by filename (without extension). */
export const mermaidDocFiles: Record<string, string> = /* @__PURE__ */ (() => {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(docFiles)) {
    const filename = path.split('/').pop()?.replace('.md', '') ?? '';
    files[filename] = content;
  }
  return files;
})();

/**
 * Annotate mermaid errors inline: for each broken ```mermaid...``` block in `fieldText`,
 * append an HTML comment with the error message right after the closing ```.
 */
export function annotateMermaidErrors(
  fieldText: string,
  errors: Array<{ source: string; error: string }>,
): string {
  let result = fieldText;
  for (const { source, error } of errors) {
    // Match the exact mermaid block containing this source
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('```mermaid\\n' + escaped + '\\n```');
    result = result.replace(re, (match) => `${match}\n<!-- MERMAID ERROR: ${error} -->`);
  }
  return result;
}

/**
 * Get recovery documentation for broken diagrams: relevant cheatsheets.
 */
export function getRecoveryDocs(errors: Array<{ source: string; error: string }>): string {
  return getRelevantCheatsheet(errors.map(e => e.source));
}

/**
 * Get relevant documentation for the given broken diagram sources.
 * Deduplicates when multiple diagrams use the same type.
 */
export function getRelevantCheatsheet(sources: string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const src of sources) {
    // First non-empty, non-comment line gives the diagram type keyword
    const firstLine = src.split('\n').find(l => l.trim() && !l.trim().startsWith('%%'));
    if (!firstLine) continue;
    const keyword = firstLine.trim().split(/[\s{]/)[0];
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    const section = mermaidDocSections[keyword];
    if (section) parts.push(section);
  }
  return parts.length > 0
    ? '\n\nRelevant Mermaid syntax reference:\n\n' + parts.join('\n\n---\n\n')
    : '';
}
