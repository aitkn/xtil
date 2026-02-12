import { Readability, isProbablyReaderable } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import type { ContentExtractor, ExtractedContent } from './types';
import { extractRichImages, pickThumbnail } from './image-utils';
import { refineTitleIfGeneric } from './title-utils';

export const articleExtractor: ContentExtractor = {
  canExtract(_url: string, doc: Document): boolean {
    return isProbablyReaderable(doc);
  },

  extract(url: string, doc: Document): ExtractedContent {
    const clonedDoc = doc.cloneNode(true) as Document;
    const reader = new Readability(clonedDoc);
    const article = reader.parse();

    if (!article) {
      throw new Error('Failed to parse article content');
    }

    const language =
      doc.documentElement.lang ||
      doc.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content') ||
      undefined;

    const publishDate =
      doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
      doc.querySelector('time[datetime]')?.getAttribute('datetime') ||
      undefined;

    const author =
      article.byline ||
      doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
      undefined;

    // Convert HTML content to simple markdown
    let content = htmlToMarkdown(article.content);

    // Rescue data tables that Readability may have stripped
    const rescued = rescueDataTables(doc, article.content);
    if (rescued) content += '\n\n' + rescued;

    const wordCount = content.split(/\s+/).filter(Boolean).length;

    // Extract image URLs
    const tempDiv = doc.createElement('div');
    tempDiv.innerHTML = DOMPurify.sanitize(article.content);
    const images = Array.from(tempDiv.querySelectorAll('img'))
      .map((img) => img.src)
      .filter(Boolean);
    const richImages = extractRichImages(tempDiv);

    // Hero image: og:image, twitter:image, or best article image (skip tiny icons)
    const thumbnailUrl =
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
      pickThumbnail(tempDiv, images) ||
      undefined;

    return {
      type: 'article',
      url,
      title: refineTitleIfGeneric(article.title, doc, url),
      author,
      publishDate,
      language,
      content,
      wordCount,
      estimatedReadingTime: Math.ceil(wordCount / 200),
      thumbnailUrl,
      images,
      richImages,
    };
  },
};

function htmlToMarkdown(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = DOMPurify.sanitize(html);

  let md = '';

  function processNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(processNode).join('');

    switch (tag) {
      case 'h1':
        return `\n# ${children}\n`;
      case 'h2':
        return `\n## ${children}\n`;
      case 'h3':
        return `\n### ${children}\n`;
      case 'h4':
        return `\n#### ${children}\n`;
      case 'h5':
        return `\n##### ${children}\n`;
      case 'h6':
        return `\n###### ${children}\n`;
      case 'p':
        return `\n${children}\n`;
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return `**${children}**`;
      case 'em':
      case 'i':
        return `*${children}*`;
      case 'a': {
        const href = el.getAttribute('href');
        return href ? `[${children}](${href})` : children;
      }
      case 'ul':
        return `\n${children}\n`;
      case 'ol':
        return `\n${children}\n`;
      case 'li': {
        const parent = el.parentElement;
        if (parent?.tagName.toLowerCase() === 'ol') {
          const index = Array.from(parent.children).indexOf(el) + 1;
          return `${index}. ${children}\n`;
        }
        return `- ${children}\n`;
      }
      case 'blockquote':
        return `\n> ${children.trim().replace(/\n/g, '\n> ')}\n`;
      case 'code':
        if (el.parentElement?.tagName.toLowerCase() === 'pre') {
          return children;
        }
        return `\`${children}\``;
      case 'pre':
        return `\n\`\`\`\n${children}\n\`\`\`\n`;
      case 'img': {
        const src = el.getAttribute('src');
        const alt = el.getAttribute('alt') || '';
        return src ? `![${alt}](${src})` : '';
      }
      case 'hr':
        return '\n---\n';
      case 'figure':
        return `\n${children}\n`;
      case 'figcaption':
        return `\n*${children.trim()}*\n`;
      case 'table': {
        const caption = el.querySelector(':scope > caption');
        const captionText = caption
          ? `**${Array.from(caption.childNodes).map(processNode).join('').trim()}**\n\n`
          : '';
        // Collect rows respecting thead/tbody/tfoot structure
        const headRows: Element[] = [];
        const bodyRows: Element[] = [];
        for (const child of Array.from(el.children)) {
          if (child.tagName === 'THEAD') {
            headRows.push(...Array.from(child.children).filter(c => c.tagName === 'TR'));
          } else if (child.tagName === 'TBODY' || child.tagName === 'TFOOT') {
            bodyRows.push(...Array.from(child.children).filter(c => c.tagName === 'TR'));
          } else if (child.tagName === 'TR') {
            bodyRows.push(child);
          }
        }
        // If no thead, promote first body row to header
        if (headRows.length === 0 && bodyRows.length > 0) {
          headRows.push(bodyRows.shift()!);
        }
        if (headRows.length === 0 && bodyRows.length === 0) return captionText;
        const allRows = [...headRows, ...bodyRows];
        // Build 2D grid
        const grid: string[][] = allRows.map(row => {
          const cells = Array.from(row.children).filter(c => c.tagName === 'TH' || c.tagName === 'TD');
          return cells.map(cell =>
            Array.from(cell.childNodes).map(processNode).join('')
              .trim().replace(/\n/g, ' ').replace(/\|/g, '\\|')
          );
        });
        // Normalize column count
        const colCount = Math.max(...grid.map(r => r.length));
        for (const row of grid) {
          while (row.length < colCount) row.push('');
        }
        // Build markdown pipe table
        const lines: string[] = [];
        for (let i = 0; i < headRows.length; i++) {
          lines.push('| ' + grid[i].join(' | ') + ' |');
        }
        lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
        for (let i = headRows.length; i < grid.length; i++) {
          lines.push('| ' + grid[i].join(' | ') + ' |');
        }
        return '\n' + captionText + lines.join('\n') + '\n';
      }
      case 'div':
      case 'section':
      case 'article':
      case 'main':
      case 'span':
        return children;
      default:
        return children;
    }
  }

  md = processNode(div);

  // Clean up excessive whitespace
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

/** Rescue data tables from the original DOM that Readability tends to strip. */
function rescueDataTables(doc: Document, readabilityHtml: string): string {
  const contentRoot = doc.querySelector(
    '#mw-content-text, article, [role="main"], main, .content, .post-content, .entry-content'
  ) || doc.body;
  if (!contentRoot) return '';

  const skipClasses = /navbox|sidebar|infobox|metadata|ambox|mbox|footer|navigation/i;
  const parts: string[] = [];

  for (const table of Array.from(contentRoot.querySelectorAll('table'))) {
    const rows = table.querySelectorAll('tr');
    const dataCells = table.querySelectorAll('td');
    // Must be a substantial data table
    if (rows.length < 3 || dataCells.length < 3) continue;
    // Skip navigation/metadata tables
    if (skipClasses.test(table.className)) continue;
    // Skip tables that Readability already preserved — check via unique cell text
    const sampleCell = table.querySelector('td:nth-child(2)')?.textContent?.trim().substring(0, 40);
    if (sampleCell && readabilityHtml.includes(sampleCell)) continue;
    parts.push(htmlToMarkdown(table.outerHTML));
  }

  return parts.join('\n\n');
}
