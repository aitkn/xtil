import { Fragment } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import type { SummaryDocument } from '@/lib/summarizer/types';
import type { ExtractedContent } from '@/lib/extractors/types';
import { MarkdownRenderer, InlineMarkdown, fixMermaidSyntax } from '@/components/MarkdownRenderer';

const LANG_LABELS: Record<string, string> = {
  en: 'EN', es: 'ES', fr: 'FR', de: 'DE',
  pt: 'PT', ru: 'RU', zh: 'ZH', ja: 'JA', ko: 'KO',
};

interface SummaryContentProps {
  summary: SummaryDocument;
  content: ExtractedContent | null;
  onExport?: () => void;
  notionUrl?: string | null;
  exporting?: boolean;
  onNavigate?: (url: string) => void;
  onDeleteSection?: (sectionKey: string) => void;
  onAdjustSection?: (sectionTitle: string, direction: 'more' | 'less') => void;
  /** Continue a truncated section — appends to existing content instead of rewriting. */
  onContinueSection?: (sectionTitle: string) => void;
  onWebSearch?: (sectionTitle: string) => void;
  /** When set, search button is shown disabled with this tooltip instead of hidden. */
  webSearchDisabledReason?: string;
  /** Sections that have been updated via web search. */
  searchedSections?: ReadonlySet<string>;
  /** Currently active section actions (for spinning buttons). */
  activeSectionActions?: ReadonlyMap<string, 'search' | 'more' | 'less'>;
}

export function SummaryContent({ summary, content, onExport, notionUrl, exporting, onNavigate, onDeleteSection, onAdjustSection, onContinueSection, onWebSearch, webSearchDisabledReason, searchedSections, activeSectionActions }: SummaryContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mdSaved, setMdSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setMdSaved(false); setCopied(false); }, [summary]);

  const isFictionGenre = summary.genre === 'narrative-fiction' || summary.genre === 'comedy';

  // Split TL;DR into body and status line for color-coded rendering
  const { body: tldrBody, statusLabel, statusText } = splitTldrStatus(summary.tldr);

  // Intercept link clicks — navigate the active browser tab instead of the sidepanel
  const handleLinkClick = (e: MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const url = anchor.href;
    if (!url || url.startsWith('javascript:')) return;
    e.preventDefault();
    e.stopPropagation();
    if (onNavigate) onNavigate(url);
    else window.open(url, '_blank');
  };

  const spinning = (title: string) => activeSectionActions?.get(title) ?? null;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
    <div ref={containerRef} data-summary-container onClick={handleLinkClick}>
      {/* TLDR */}
      {summary.tldr && (
        <Section title="TL;DR" defaultOpen
          onDelete={onDeleteSection ? () => onDeleteSection('tldr') : undefined}
          onMore={onAdjustSection ? () => onAdjustSection('TL;DR', 'more') : undefined}
          onLess={onAdjustSection ? () => onAdjustSection('TL;DR', 'less') : undefined}
          onWebSearch={onWebSearch ? () => onWebSearch('TL;DR') : undefined}
          spinningAction={spinning('TL;DR')}
          webSearchDisabledReason={!onWebSearch ? webSearchDisabledReason : undefined}
        >
          <div class="summary-callout">
            <div style={{ font: 'var(--md-sys-typescale-body-large)', lineHeight: 1.5 }}><MarkdownRenderer content={tldrBody} /></div>
            {(statusLabel || statusText) && (
              <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: 'var(--md-sys-shape-corner-medium)', backgroundColor: 'var(--md-sys-color-surface-container)', display: 'flex', alignItems: 'baseline', gap: '8px', font: 'var(--md-sys-typescale-body-medium)', lineHeight: 1.4 }}>
                {statusLabel && <StatusBadge label={statusLabel} fallbackState={content?.prState || content?.issueState} />}
                {statusText && <span style={{ color: 'var(--md-sys-color-on-surface)' }}><InlineMarkdown text={statusText} /></span>}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Key Takeaways */}
      {summary.keyTakeaways.length > 0 && (
        <Section title={isFictionGenre ? 'Work Info' : 'Key Takeaways'} defaultOpen
          onDelete={onDeleteSection ? () => onDeleteSection('keyTakeaways') : undefined}
          onMore={onAdjustSection ? () => onAdjustSection(isFictionGenre ? 'Work Info' : 'Key Takeaways', 'more') : undefined}
          onLess={onAdjustSection ? () => onAdjustSection(isFictionGenre ? 'Work Info' : 'Key Takeaways', 'less') : undefined}
          onWebSearch={onWebSearch ? () => onWebSearch(isFictionGenre ? 'Work Info' : 'Key Takeaways') : undefined}
          spinningAction={spinning(isFictionGenre ? 'Work Info' : 'Key Takeaways')}
          webSearchDisabledReason={!onWebSearch ? webSearchDisabledReason : undefined}
        >
          {isFictionGenre ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '2px 10px',
              font: 'var(--md-sys-typescale-body-small)',
              lineHeight: 1.5,
            }}>
              {summary.keyTakeaways.map((point, i) => {
                const match = point.match(/^\*\*(.+?)\*\*\s*[—–\-:]\s*(.+)$/);
                const label = match ? match[1] : '';
                const value = match ? match[2] : point;
                return (
                  <Fragment key={i}>
                    <span style={{
                      fontWeight: 700,
                      color: 'var(--md-sys-color-primary)',
                      whiteSpace: 'nowrap',
                      padding: '3px 0',
                    }}>{label || '\u00B7'}</span>
                    <span style={{
                      color: 'var(--md-sys-color-on-surface)',
                      padding: '3px 0',
                      borderBottom: '1px solid var(--md-sys-color-outline-variant)',
                    }}><WorkInfoValue text={value} label={label} /></span>
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <ol style={{ paddingLeft: '24px', font: 'var(--md-sys-typescale-body-medium)', lineHeight: 1.6, color: 'var(--md-sys-color-on-surface)' }}>
              {summary.keyTakeaways.map((point, i) => (
                <li key={i} style={{ marginBottom: '4px', paddingLeft: '4px' }}><InlineMarkdown text={point} /></li>
              ))}
            </ol>
          )}
        </Section>
      )}

      {/* Summary — spoiler for fiction genres (contains full plot with spoilers) */}
      {summary.summary && (
        <Section title={isFictionGenre ? 'Plot Summary' : 'Summary'} defaultOpen={!isFictionGenre} spoiler={isFictionGenre}
          onDelete={onDeleteSection ? () => onDeleteSection('summary') : undefined}
          onMore={onAdjustSection ? () => onAdjustSection('Summary', 'more') : undefined}
          onLess={onAdjustSection ? () => onAdjustSection('Summary', 'less') : undefined}
          onWebSearch={onWebSearch ? () => onWebSearch('Summary') : undefined}
          spinningAction={spinning('Summary')}
          webSearchDisabledReason={!onWebSearch ? webSearchDisabledReason : undefined}
        >
          <div style={{ font: 'var(--md-sys-typescale-body-medium)', lineHeight: 1.6 }}>
            <MarkdownRenderer content={summary.summary} />
          </div>
        </Section>
      )}

      {/* Notable Quotes */}
      {summary.notableQuotes.length > 0 && (
        <Section title="Notable Quotes"
          onDelete={onDeleteSection ? () => onDeleteSection('notableQuotes') : undefined}
          onMore={onAdjustSection ? () => onAdjustSection('Notable Quotes', 'more') : undefined}
          onLess={onAdjustSection ? () => onAdjustSection('Notable Quotes', 'less') : undefined}
          onWebSearch={onWebSearch ? () => onWebSearch('Notable Quotes') : undefined}
          spinningAction={spinning('Notable Quotes')}
          webSearchDisabledReason={!onWebSearch ? webSearchDisabledReason : undefined}
        >
          {summary.notableQuotes.map((quote, i) => (
            <blockquote key={i} style={{
              borderLeft: '3px solid var(--md-sys-color-outline-variant)',
              paddingLeft: '12px',
              margin: '8px 0',
              color: 'var(--md-sys-color-on-surface-variant)',
              font: 'var(--md-sys-typescale-body-medium)',
              fontStyle: 'italic',
            }}>
              "<InlineMarkdown text={quote} />"
            </blockquote>
          ))}
        </Section>
      )}

      {/* Pros and Cons */}
      {summary.prosAndCons && (
        <Section title="Pros & Cons"
          onDelete={onDeleteSection ? () => onDeleteSection('prosAndCons') : undefined}
          onMore={onAdjustSection ? () => onAdjustSection('Pros & Cons', 'more') : undefined}
          onLess={onAdjustSection ? () => onAdjustSection('Pros & Cons', 'less') : undefined}
          onWebSearch={onWebSearch ? () => onWebSearch('Pros & Cons') : undefined}
          spinningAction={spinning('Pros & Cons')}
          webSearchDisabledReason={!onWebSearch ? webSearchDisabledReason : undefined}
        >
          <div class="pros-cons-grid">
            <div class="pros-card">
              <strong>Pros</strong>
              <ul>
                {summary.prosAndCons.pros.map((p, i) => <li key={i}><InlineMarkdown text={p} /></li>)}
              </ul>
            </div>
            <div class="cons-card">
              <strong>Cons</strong>
              <ul>
                {summary.prosAndCons.cons.map((c, i) => <li key={i}><InlineMarkdown text={c} /></li>)}
              </ul>
            </div>
          </div>
        </Section>
      )}

      {/* Fact Check */}
      {summary.factCheck && (
        <Section title="Fact Check"
          subtitle={spinning('Fact Check') === 'search' ? '(searching web\u2026)' : !searchedSections?.has('Fact Check') ? '(use search to update)' : undefined}
          titleColor={searchedSections?.has('Fact Check') ? 'var(--md-sys-color-success)' : 'var(--md-sys-color-warning)'}
          onDelete={onDeleteSection ? () => onDeleteSection('factCheck') : undefined}
          onMore={onAdjustSection ? () => onAdjustSection('Fact Check', 'more') : undefined}
          onLess={onAdjustSection ? () => onAdjustSection('Fact Check', 'less') : undefined}
          onWebSearch={onWebSearch ? () => onWebSearch('Fact Check') : undefined}
          spinningAction={spinning('Fact Check')}
          webSearchDisabledReason={!onWebSearch ? webSearchDisabledReason : undefined}
        >
          <div style={{ font: 'var(--md-sys-typescale-body-medium)', lineHeight: 1.5 }}>
            <MarkdownRenderer content={summary.factCheck} />
          </div>
        </Section>
      )}

      {/* Comments Highlights */}
      {summary.commentsHighlights && summary.commentsHighlights.length > 0 && (
        <Section title="Comment Highlights"
          onDelete={onDeleteSection ? () => onDeleteSection('commentsHighlights') : undefined}
          onMore={onAdjustSection ? () => onAdjustSection('Comment Highlights', 'more') : undefined}
          onLess={onAdjustSection ? () => onAdjustSection('Comment Highlights', 'less') : undefined}
          onWebSearch={onWebSearch ? () => onWebSearch('Comment Highlights') : undefined}
          spinningAction={spinning('Comment Highlights')}
          webSearchDisabledReason={!onWebSearch ? webSearchDisabledReason : undefined}
        >
          <ul style={{ paddingLeft: '20px', font: 'var(--md-sys-typescale-body-medium)', lineHeight: 1.6 }}>
            {summary.commentsHighlights.map((h, i) => <li key={i}><InlineMarkdown text={h} /></li>)}
          </ul>
        </Section>
      )}

      {/* Conclusion */}
      {summary.conclusion && (
        <Section title="Conclusion"
          onDelete={onDeleteSection ? () => onDeleteSection('conclusion') : undefined}
          onMore={onAdjustSection ? () => onAdjustSection('Conclusion', 'more') : undefined}
          onLess={onAdjustSection ? () => onAdjustSection('Conclusion', 'less') : undefined}
          onWebSearch={onWebSearch ? () => onWebSearch('Conclusion') : undefined}
          spinningAction={spinning('Conclusion')}
          webSearchDisabledReason={!onWebSearch ? webSearchDisabledReason : undefined}
        >
          <div class="summary-callout-conclusion">
            <div style={{ font: 'var(--md-sys-typescale-body-medium)', lineHeight: 1.5 }}>
              <MarkdownRenderer content={summary.conclusion} />
            </div>
          </div>
        </Section>
      )}

      {/* Extra sections (added via chat refinement or content-type-specific) */}
      {summary.extraSections && Object.entries(summary.extraSections).map(([rawTitle, sectionContent]) => {
        const isSpoilerSection = rawTitle.startsWith('[SPOILER] ');
        const displayTitle = isSpoilerSection ? rawTitle.slice(10) : rawTitle;
        return (
          <Section key={`extra-${rawTitle}`} title={displayTitle} spoiler={isSpoilerSection}
            onDelete={onDeleteSection ? () => onDeleteSection(`extra:${rawTitle}`) : undefined}
            onMore={onAdjustSection ? () => onAdjustSection(rawTitle, 'more') : undefined}
            onLess={onAdjustSection ? () => onAdjustSection(rawTitle, 'less') : undefined}
            onWebSearch={onWebSearch ? () => onWebSearch(rawTitle) : undefined}
            spinningAction={spinning(rawTitle)}
            webSearchDisabledReason={!onWebSearch ? webSearchDisabledReason : undefined}
          >
            <div style={{ font: 'var(--md-sys-typescale-body-medium)', lineHeight: 1.6 }}>
              {/* Strip trailing continuation hints from LLM: (more), (more...), (load entire...), etc. */}
              <MarkdownRenderer content={sectionContent.replace(/\s*\(?(?:more|load\s+entire|continue|full\s+version|see\s+full)[^)]*\)?\s*\.{0,3}\s*$/i, '')} />
              {/(?:more|load\s+entire|continue|full\s+version|see\s+full)[^)]*\)?\s*\.{0,3}\s*$/i.test(sectionContent) && onContinueSection && (
                <button
                  onClick={() => onContinueSection(rawTitle)}
                  disabled={spinning(rawTitle) === 'more'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginTop: '8px',
                    padding: '4px 12px',
                    borderRadius: 'var(--md-sys-shape-corner-medium)',
                    border: '1px solid var(--md-sys-color-outline-variant)',
                    background: 'var(--md-sys-color-surface-container)',
                    color: 'var(--md-sys-color-primary)',
                    font: 'var(--md-sys-typescale-label-medium)',
                    cursor: spinning(rawTitle) === 'more' ? 'wait' : 'pointer',
                    opacity: spinning(rawTitle) === 'more' ? 0.6 : 1,
                  }}
                >
                  {spinning(rawTitle) === 'more' ? 'Expanding\u2026' : 'Show full version \u2192'}
                </button>
              )}
            </div>
          </Section>
        );
      })}

      {/* Related Topics */}
      {summary.relatedTopics.length > 0 && (
        <Section title="Related Topics" onDelete={onDeleteSection ? () => onDeleteSection('relatedTopics') : undefined}>
          <div>
            {summary.relatedTopics.map((topic, i) => (
              <a
                key={i}
                href={`https://www.google.com/search?q=${encodeURIComponent(topic)}`}
                style={{
                  display: 'inline-block',
                  backgroundColor: 'var(--md-sys-color-secondary-container)',
                  color: 'var(--md-sys-color-on-secondary-container)',
                  padding: '4px 12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  textDecoration: 'none',
                  cursor: 'pointer',
                  margin: '0 6px 6px 0',
                }}
              >
                {topic}
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Tags */}
      {summary.tags.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          {summary.tags.map((tag, i) => (
            <span key={i} style={{
              display: 'inline-block',
              backgroundColor: 'var(--md-sys-color-surface-container-highest)',
              color: 'var(--md-sys-color-on-surface-variant)',
              padding: '2px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              margin: '0 4px 4px 0',
            }}>
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Export actions */}
      <div class="no-print" style={{ display: 'flex', gap: '8px', marginTop: '8px', paddingTop: '8px', paddingBottom: '8px', borderTop: '1px solid var(--md-sys-color-outline-variant)' }}>
        {onExport && (
          notionUrl ? (
            <a
              href={notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open exported page in Notion"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 20px',
                borderRadius: '20px',
                border: '1px solid var(--md-sys-color-outline)',
                backgroundColor: 'transparent',
                color: 'var(--md-sys-color-on-surface)',
                font: 'var(--md-sys-typescale-label-large)',
                cursor: 'pointer',
                textDecoration: 'none',
              }}
            >
              Open in Notion
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <path d="M6 3H3v10h10v-3M9 3h4v4M14 2L7 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </a>
          ) : (
            <button
              onClick={onExport}
              disabled={exporting}
              title="Export summary to Notion"
              style={{
                padding: '8px 20px',
                borderRadius: '20px',
                border: 'none',
                backgroundColor: 'var(--md-sys-color-primary)',
                color: 'var(--md-sys-color-on-primary)',
                font: 'var(--md-sys-typescale-label-large)',
                cursor: exporting ? 'default' : 'pointer',
                opacity: exporting ? 0.6 : 1,
              }}
            >
              {exporting ? 'Exporting…' : 'Export to Notion'}
            </button>
          )
        )}
        <button
          onClick={() => {
            downloadMarkdown(summary, content);
            setMdSaved(true);
          }}
          disabled={mdSaved}
          title={mdSaved ? 'Markdown saved' : 'Download summary as Markdown'}
          style={{
            padding: '8px 20px',
            borderRadius: '20px',
            border: '1px solid var(--md-sys-color-outline)',
            backgroundColor: 'transparent',
            color: mdSaved ? 'var(--md-sys-color-on-surface-variant)' : 'var(--md-sys-color-on-surface)',
            font: 'var(--md-sys-typescale-label-large)',
            cursor: mdSaved ? 'default' : 'pointer',
            opacity: mdSaved ? 0.5 : 1,
          }}
        >
          {mdSaved ? 'Saved' : 'Save .md'}
        </button>
        <button
          onClick={() => {
            copyToClipboard(summary, content, containerRef.current).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          disabled={copied}
          title={copied ? 'Copied!' : 'Copy as rich text (Ctrl+V) or plain markdown (Ctrl+Shift+V)'}
          style={{
            padding: '8px 20px',
            borderRadius: '20px',
            border: '1px solid var(--md-sys-color-outline)',
            backgroundColor: 'transparent',
            color: copied ? 'var(--md-sys-color-tertiary)' : 'var(--md-sys-color-on-surface)',
            font: 'var(--md-sys-typescale-label-large)',
            cursor: copied ? 'default' : 'pointer',
            opacity: copied ? 0.7 : 1,
          }}
        >
          {copied ? '\u2713 Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function MetadataHeader({ content, summary, earlyGenre, providerName, modelName, onProviderClick }: {
  content: ExtractedContent;
  summary?: SummaryDocument;
  /** Genre from classifier broadcast — shown before summary arrives. */
  earlyGenre?: string | null;
  providerName?: string;
  modelName?: string;
  onProviderClick?: () => void;
}) {
  const badgeColors: Record<string, { bg: string; text: string }> = {
    article: { bg: 'var(--md-sys-color-success-container)', text: 'var(--md-sys-color-on-success-container)' },
    pdf: { bg: 'var(--md-sys-color-secondary-container)', text: 'var(--md-sys-color-on-secondary-container)' },
    youtube: { bg: 'var(--md-sys-color-error-container)', text: 'var(--md-sys-color-on-error-container)' },
    facebook: { bg: 'var(--md-sys-color-primary-container)', text: 'var(--md-sys-color-on-primary-container)' },
    reddit: { bg: '#FFE0B2', text: '#E65100' },
    twitter: { bg: '#E3F2FD', text: '#1565C0' },
    github: { bg: '#e1e4e8', text: '#24292e' },
    linkedin: { bg: '#dce6f1', text: '#0a66c2' },
    generic: { bg: 'var(--md-sys-color-surface-container-highest)', text: 'var(--md-sys-color-on-surface-variant)' },
  };
  const badge = badgeColors[content.type] || badgeColors.generic;

  const badgeRow = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      marginBottom: '4px',
    }}>
      <span style={{
        backgroundColor: badge.bg,
        color: badge.text,
        padding: '2px 10px',
        borderRadius: 'var(--md-sys-shape-corner-small)',
        font: 'var(--md-sys-typescale-label-small)',
        fontWeight: 600,
        textTransform: 'uppercase',
      }}>
        {content.type === 'youtube' ? 'YouTube' : content.type === 'netflix' ? 'Netflix' : content.type === 'pdf' ? 'PDF' : content.type === 'facebook' ? 'Facebook' : content.type === 'reddit' ? 'Reddit' : content.type === 'twitter' ? 'X' : content.type === 'github' ? 'GitHub' : content.type === 'linkedin' ? 'LinkedIn' : content.type}
      </span>
      {content.type !== 'github' && content.estimatedReadingTime > 0 && (
        <span style={{ color: 'var(--md-sys-color-on-surface-variant)', font: 'var(--md-sys-typescale-label-small)' }}>
          {content.estimatedReadingTime} min read
        </span>
      )}
      {summary?.sourceLanguage && summary?.summaryLanguage && summary.sourceLanguage !== summary.summaryLanguage && (
        <span style={{
          backgroundColor: 'var(--md-sys-color-tertiary-container)',
          color: 'var(--md-sys-color-on-tertiary-container)',
          padding: '2px 10px',
          borderRadius: 'var(--md-sys-shape-corner-small)',
          font: 'var(--md-sys-typescale-label-small)',
          fontWeight: 600,
        }}>
          {(LANG_LABELS[summary.sourceLanguage] || summary.sourceLanguage.toUpperCase())} → {(LANG_LABELS[summary.summaryLanguage] || summary.summaryLanguage.toUpperCase())}
        </span>
      )}
      {(() => {
        const label = summary?.llmProvider || providerName;
        const tooltip = summary?.llmModel || modelName || '';
        const configured = !!label;
        return (
          <span
            title={configured ? tooltip : 'Click to configure LLM provider'}
            onClick={onProviderClick}
            style={{
              backgroundColor: configured ? 'var(--md-sys-color-secondary-container)' : '#fef3c7',
              color: configured ? 'var(--md-sys-color-on-secondary-container)' : '#92400e',
              padding: '2px 10px',
              borderRadius: 'var(--md-sys-shape-corner-small)',
              font: 'var(--md-sys-typescale-label-small)',
              fontWeight: 600,
              cursor: onProviderClick ? 'pointer' : 'default',
            }}
          >
            {configured ? label : 'Configure LLM'}
          </span>
        );
      })()}
      {(() => {
        const genre = summary?.genre || earlyGenre;
        if (!genre || genre === 'generic') return null;
        const subGenre = summary?.subGenre;
        const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        // For 'software' (GitHub), prefer subGenre (PR / Issue / Code / Repo / Commit / Release)
        // since the user already knows they're on GitHub — the page-type is the signal that matters.
        const githubLabels: Record<string, string> = {
          pr: 'PR', issue: 'Issue', code: 'Code', repo: 'Repo', commit: 'Commit', release: 'Release',
        };
        const label = genre === 'software' && subGenre
          ? (githubLabels[subGenre] ?? titleCase(subGenre))
          : titleCase(genre);
        return (
          <span
            title={subGenre ? `${genre} / ${subGenre}` : genre}
            style={{
              backgroundColor: 'var(--md-sys-color-surface-container-highest)',
              color: 'var(--md-sys-color-on-surface-variant)',
              padding: '2px 10px',
              borderRadius: 'var(--md-sys-shape-corner-small)',
              font: 'var(--md-sys-typescale-label-small)',
              fontWeight: 600,
            }}
          >
            {label}
          </span>
        );
      })()}
    </div>
  );

  const thumbnailImg = content.thumbnailUrls && content.thumbnailUrls.length >= 2 ? (
    <ThumbnailCollage urls={content.thumbnailUrls} title={content.title} fallbackUrl={content.thumbnailUrl} />
  ) : content.thumbnailUrl ? (
    <img
      src={content.thumbnailUrl}
      alt={content.title}
      style={{ width: '100%', maxHeight: '320px', objectFit: 'contain', borderRadius: 'var(--md-sys-shape-corner-medium)', marginBottom: '8px', display: 'block' }}
      onError={(e) => {
        const img = e.currentTarget as HTMLImageElement;
        if (content.type === 'youtube') {
          const hqFallback = content.thumbnailUrl!.replace(/\/[^/]+\.jpg$/, '/hqdefault.jpg');
          if (img.src !== hqFallback) {
            img.src = hqFallback;
            return;
          }
        }
        img.style.display = 'none';
      }}
    />
  ) : null;

  const hasThumbnail = thumbnailImg !== null;

  return (
    <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--md-sys-color-outline-variant)' }}>
      {hasThumbnail ? (
        // Wrapper scopes sticky badges to the image area only
        <div>
          {badgeRow}
          {thumbnailImg}
        </div>
      ) : (
        <>
          {badgeRow}
        </>
      )}

      <h2 style={{ font: 'var(--md-sys-typescale-title-medium)', lineHeight: 1.3, margin: '4px 0', color: 'var(--md-sys-color-on-surface)' }}>
        {summary?.translatedTitle || content.title || summary?.inferredTitle || ''}
      </h2>

      <div style={{ font: 'var(--md-sys-typescale-body-small)', color: 'var(--md-sys-color-on-surface-variant)', display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
        {(content.author || summary?.inferredAuthor) && (
          <span>By {content.author || summary?.inferredAuthor}</span>
        )}
        {(content.publishDate || summary?.inferredPublishDate) && (
          <span>{formatDate(content.publishDate || summary?.inferredPublishDate || '')}</span>
        )}
        {content.duration && <span>{content.duration}</span>}
        {content.viewCount && <span>{content.viewCount} views</span>}
        {content.showType && (
          <span style={{ fontStyle: 'italic' }}>
            {content.showType.charAt(0).toUpperCase() + content.showType.slice(1)}
          </span>
        )}
        {content.maturityRating && (
          <span style={{
            backgroundColor: 'var(--md-sys-color-surface-container-highest)',
            color: 'var(--md-sys-color-on-surface-variant)',
            padding: '2px 8px', borderRadius: '12px',
            font: 'var(--md-sys-typescale-label-small)', fontWeight: 600,
          }}>
            {content.maturityRating}
          </span>
        )}
        {content.seasonNumber != null && content.episodeNumber != null && (
          <span>S{content.seasonNumber} E{content.episodeNumber}</span>
        )}
        {content.episodeTitle && content.episodeTitle !== content.title && (
          <span style={{ fontStyle: 'italic' }}>{content.episodeTitle}</span>
        )}
        {content.seasonCount != null && content.seasonCount > 0 && (
          <span>{content.seasonCount} season{content.seasonCount > 1 ? 's' : ''}</span>
        )}
        {content.type === 'github' && content.prState && (
          <span style={{
            backgroundColor: content.prState === 'merged' ? '#8250df' : content.prState === 'open' ? '#1a7f37' : '#cf222e',
            color: '#fff', padding: '2px 8px', borderRadius: '12px',
            font: 'var(--md-sys-typescale-label-small)', fontWeight: 600,
          }}>
            {content.prState.charAt(0).toUpperCase() + content.prState.slice(1)}
          </span>
        )}
        {content.type === 'github' && content.prNumber && (
          <span style={{ font: 'var(--md-sys-typescale-label-small)', fontWeight: 600 }}>
            #{content.prNumber}
          </span>
        )}
        {content.type === 'github' && content.issueState && !content.prState && (
          <span style={{
            backgroundColor: content.issueState === 'open' ? '#1a7f37' : '#cf222e',
            color: '#fff', padding: '2px 8px', borderRadius: '12px',
            font: 'var(--md-sys-typescale-label-small)', fontWeight: 600,
          }}>
            {content.issueState.charAt(0).toUpperCase() + content.issueState.slice(1)}
          </span>
        )}
      </div>
    </div>
  );
}

function ThumbnailCollage({ urls, title, fallbackUrl }: { urls: string[]; title: string; fallbackUrl?: string }) {
  const [failed, setFailed] = useState(false);
  const count = urls.length; // 2, 3, or 4

  if (failed) {
    // Fallback to single image
    return fallbackUrl ? (
      <img
        src={fallbackUrl}
        alt={title}
        style={{ width: '100%', maxHeight: '320px', objectFit: 'contain', borderRadius: 'var(--md-sys-shape-corner-medium)', marginBottom: '8px' }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    ) : null;
  }

  const gap = '2px';
  const imgStyle = { objectFit: 'cover' as const, width: '100%', height: '100%', display: 'block' as const };

  const onImgError = () => setFailed(true);

  if (count === 2) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap, borderRadius: 'var(--md-sys-shape-corner-medium)', overflow: 'hidden', aspectRatio: '16/9', maxHeight: '320px', marginBottom: '8px' }}>
        <img src={urls[0]} alt={title} style={imgStyle} onError={onImgError} />
        <img src={urls[1]} alt={title} style={imgStyle} onError={onImgError} />
      </div>
    );
  }

  if (count === 3) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap, borderRadius: 'var(--md-sys-shape-corner-medium)', overflow: 'hidden', aspectRatio: '16/9', maxHeight: '320px', marginBottom: '8px' }}>
        <img src={urls[0]} alt={title} style={{ ...imgStyle, gridRow: '1 / 3' }} onError={onImgError} />
        <img src={urls[1]} alt={title} style={imgStyle} onError={onImgError} />
        <img src={urls[2]} alt={title} style={imgStyle} onError={onImgError} />
      </div>
    );
  }

  // count === 4
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap, borderRadius: 'var(--md-sys-shape-corner-medium)', overflow: 'hidden', aspectRatio: '16/9', maxHeight: '320px', marginBottom: '8px' }}>
      <img src={urls[0]} alt={title} style={imgStyle} onError={onImgError} />
      <img src={urls[1]} alt={title} style={imgStyle} onError={onImgError} />
      <img src={urls[2]} alt={title} style={imgStyle} onError={onImgError} />
      <img src={urls[3]} alt={title} style={imgStyle} onError={onImgError} />
    </div>
  );
}

// --- Netflix info value with color-coded rating badges ---

/** Content/age rating color: red for mature, orange for teens, green for general. */
function contentRatingColor(rating: string): { bg: string; fg: string } {
  const r = rating.toUpperCase();
  if (['TV-MA', 'R', 'NC-17', '18+', 'X'].includes(r)) return { bg: '#b71c1c', fg: '#fff' };
  if (['TV-14', 'PG-13', 'TV-PG', '13+', '16+'].includes(r)) return { bg: '#e65100', fg: '#fff' };
  if (['TV-Y7', 'PG', 'TV-G', 'TV-Y', 'G', '7+'].includes(r)) return { bg: '#2e7d32', fg: '#fff' };
  return { bg: '#546e7a', fg: '#fff' };
}

/** Review score color: green >=70, yellow >=50, red <50. Works for x/10, x%, etc. */
function scoreColor(value: number, max: number): { bg: string; fg: string } {
  const pct = (value / max) * 100;
  if (pct >= 70) return { bg: '#2e7d32', fg: '#fff' };
  if (pct >= 50) return { bg: '#f57f17', fg: '#fff' };
  return { bg: '#c62828', fg: '#fff' };
}

const badgeStyle = (colors: { bg: string; fg: string }) => ({
  display: 'inline-block',
  padding: '1px 7px',
  borderRadius: '4px',
  fontWeight: 700 as const,
  fontSize: '11px',
  lineHeight: '18px',
  backgroundColor: colors.bg,
  color: colors.fg,
  verticalAlign: 'middle',
  marginRight: '3px',
});

/** Render text with color-coded badges for content ratings & review scores. */
function WorkInfoValue({ text, label }: { text: string; label?: string }) {
  // Strip markdown bold/italic that LLMs wrap around scores — breaks badge regex matching
  // e.g. "IMDb **7.5**/10" → "IMDb 7.5/10", "Rotten Tomatoes **60**%" → "Rotten Tomatoes 60%"
  const cleanText = text.replace(/\*{1,2}(\S.*?\S|\S)\*{1,2}/g, '$1');

  // Split text into segments, replacing known patterns with badges
  const parts: preact.ComponentChildren[] = [];
  let key = 0;

  // Only match standalone R/G when the label indicates a rating context
  const isRatingLabel = /rating|rated/i.test(label || '');

  const badgePatterns = [
    // Content ratings — hyphenated ones are always unambiguous
    { re: /\b(TV-MA|TV-14|TV-PG|TV-G|TV-Y7|TV-Y|NC-17|PG-13|PG|NR|UR)\b/g, type: 'content' as const },
    // Standalone R/G only in rating-labeled rows to avoid false positives
    ...(isRatingLabel ? [{ re: /\b(R|G)\b/g, type: 'content' as const }] : []),
    // IMDb ~x.x/10 or x/10 or just IMDb x.x (with optional :, ~, approx, etc.)
    { re: /\bIMDb[:\s]*[~≈]?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*10)?\b/gi, type: 'imdb' as const },
    // Rotten Tomatoes / RT xx% (with optional colon, "Critics:", "Audience:")
    { re: /\b(?:Rotten\s+Tomato(?:es)?|RT)\s*(?:Critics|Audience)?[:\s]*[~≈]?\s*(\d+)\s*%/gi, type: 'rt' as const },
    // Metacritic / MC xx/100 or xx% (with optional colon)
    { re: /\b(?:Metacritic|MC)[:\s]*[~≈]?\s*(\d+)\s*(?:\/\s*100|%)?/gi, type: 'meta' as const },
  ];

  // Collect all badge matches against cleaned text (positions align with cleanText)
  const badges: Array<{ start: number; end: number; node: preact.ComponentChildren }> = [];
  for (const { re, type } of badgePatterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(cleanText)) !== null) {
      if (type === 'content') {
        const rating = m[1].toUpperCase();
        const colors = contentRatingColor(rating);
        badges.push({ start: m.index, end: m.index + m[0].length, node: <span key={key++} style={badgeStyle(colors)}>{rating}</span> });
      } else if (type === 'imdb') {
        const val = parseFloat(m[1]);
        const colors = scoreColor(val, 10);
        badges.push({ start: m.index, end: m.index + m[0].length, node: <span key={key++} style={badgeStyle(colors)}>IMDb {m[1]}/10</span> });
      } else if (type === 'rt') {
        const val = parseInt(m[1], 10);
        // RT uses "fresh" (>=60%) = red tomato, "rotten" (<60%) = grey-green
        const rtColors = { bg: val >= 60 ? '#d32f2f' : '#546e7a', fg: '#fff' };
        badges.push({ start: m.index, end: m.index + m[0].length, node: <span key={key++} style={badgeStyle(rtColors)}>🍅 {m[1]}%</span> });
      } else if (type === 'meta') {
        const val = parseInt(m[1], 10);
        const colors = scoreColor(val, 100);
        badges.push({ start: m.index, end: m.index + m[0].length, node: <span key={key++} style={badgeStyle(colors)}>MC {m[1]}/100</span> });
      }
    }
  }

  if (badges.length === 0) return <InlineMarkdown text={text} />;

  // Sort by position and build output (positions reference cleanText)
  badges.sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const b of badges) {
    if (b.start < pos) continue; // skip overlapping matches
    if (b.start > pos) {
      const seg = cleanText.slice(pos, b.start);
      if (seg.trim()) parts.push(<InlineMarkdown key={key++} text={seg} />);
    }
    parts.push(b.node);
    pos = b.end;
  }
  if (pos < cleanText.length) {
    parts.push(<InlineMarkdown key={key++} text={cleanText.slice(pos)} />);
  }

  return <>{parts}</>;
}

// Track user-toggled section state by title so it survives re-renders / remounts
const sectionUserState = new Map<string, boolean>();

/** Reset user section overrides (call when generating a fresh summary for a new page). */
export function resetSectionState() { sectionUserState.clear(); }

function Section({ title, subtitle, titleColor, defaultOpen = false, spoiler = false, onDelete, onMore, onLess, onWebSearch, webSearchDisabledReason, spinningAction, children }: {
  title: string;
  subtitle?: string;
  titleColor?: string;
  defaultOpen?: boolean;
  /** When true, section always starts closed with a spoiler badge, ignoring saved state. */
  spoiler?: boolean;
  onDelete?: () => void;
  onMore?: () => void;
  onLess?: () => void;
  onWebSearch?: () => void;
  /** When set, the search button is shown but disabled with this tooltip. */
  webSearchDisabledReason?: string;
  /** Which button is currently spinning (in-progress action). */
  spinningAction?: 'search' | 'more' | 'less' | null;
  children: preact.ComponentChildren;
}) {
  // Spoiler sections always start closed — ignore saved state
  const [open, setOpen] = useState(spoiler ? false : (sectionUserState.get(title) ?? defaultOpen));

  const toggle = () => {
    const next = !open;
    if (!spoiler) sectionUserState.set(title, next); // don't persist spoiler toggle
    setOpen(next);
  };

  const showSearchButton = onWebSearch || webSearchDisabledReason;
  const hasToolbar = onDelete || onMore || onLess || showSearchButton;

  return (
    <div class="summary-section" style={{ marginBottom: '4px', position: 'relative' }}>
      <button
        onClick={toggle}
        title={open ? `Collapse ${title}` : `Expand ${title}`}
        aria-expanded={open}
        aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
        class="section-toggle"
        style={{
          background: 'none',
          border: 'none',
          width: '100%',
          textAlign: 'left',
          padding: '10px 0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          font: 'var(--md-sys-typescale-title-small)',
          color: 'var(--md-sys-color-on-surface)',
          userSelect: 'text',
        }}
      >
        <span style={{
          transform: open ? 'rotate(90deg)' : 'rotate(0)',
          transition: 'transform 0.15s',
          fontSize: '10px',
          color: 'var(--md-sys-color-on-surface-variant)',
        }}>&#9654;</span>
        <span style={titleColor ? { color: titleColor } : undefined}>{title}</span>
        {spoiler && (
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            padding: '1px 6px',
            borderRadius: 'var(--md-sys-shape-corner-small)',
            backgroundColor: 'var(--md-sys-color-error-container)',
            color: 'var(--md-sys-color-on-error-container)',
            marginLeft: '6px',
          }}>Spoiler</span>
        )}
        {subtitle && <span style={{ font: 'var(--md-sys-typescale-label-small)', color: titleColor || 'var(--md-sys-color-on-surface-variant)', opacity: 0.7, marginLeft: '4px' }}>{subtitle}</span>}
      </button>
      {hasToolbar && (
        <div class="section-toolbar no-print">
          {showSearchButton && (
            <button
              onClick={onWebSearch ? (e) => { e.stopPropagation(); onWebSearch(); } : undefined}
              disabled={!onWebSearch}
              class={`section-toolbar-search${!onWebSearch ? ' disabled' : ''}${spinningAction === 'search' ? ' spinning' : ''}`}
              title={webSearchDisabledReason || 'Update with web search'}
              aria-label={webSearchDisabledReason || 'Update with web search'}
            >
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="6.5" cy="6.5" r="4.5" /><line x1="10" y1="10" x2="14" y2="14" />
              </svg>
            </button>
          )}
          {onMore && (
            <button class={spinningAction === 'more' ? 'spinning' : undefined} onClick={(e) => { e.stopPropagation(); onMore(); }} title="Elaborate more" aria-label="Elaborate more">+</button>
          )}
          {onLess && (
            <button class={spinningAction === 'less' ? 'spinning' : undefined} onClick={(e) => { e.stopPropagation(); onLess(); }} title="Make shorter" aria-label="Make shorter">&minus;</button>
          )}
          {onDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} class="section-toolbar-delete" title={`Remove ${title}`} aria-label={`Remove ${title}`}>&#215;</button>
          )}
        </div>
      )}
      <div class="section-content" style={{ paddingLeft: '4px', paddingBottom: '8px', display: open ? 'block' : 'none' }}>{children}</div>
    </div>
  );
}

function summaryToMarkdown(summary: SummaryDocument, content: ExtractedContent | null): string {
  const lines: string[] = [];

  if (content) {
    const displayTitle = summary.translatedTitle || content.title || summary.inferredTitle || 'Untitled';
    lines.push(`# ${displayTitle}`, '');
    const meta: string[] = [];
    if (content.author || summary.inferredAuthor) meta.push(`**Author:** ${content.author || summary.inferredAuthor}`);
    if (content.publishDate || summary.inferredPublishDate) meta.push(`**Date:** ${content.publishDate || summary.inferredPublishDate}`);
    if (content.url) meta.push(`**Source:** ${content.url}`);
    if (meta.length) lines.push(meta.join(' | '), '');
  }

  if (summary.tldr) {
    lines.push('## TL;DR', '', summary.tldr, '');
  }

  if (summary.keyTakeaways.length > 0) {
    lines.push('## Key Takeaways', '');
    summary.keyTakeaways.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push('');
  }

  if (summary.summary) {
    lines.push('## Summary', '', summary.summary, '');
  }

  if (summary.notableQuotes.length > 0) {
    lines.push('## Notable Quotes', '');
    for (const q of summary.notableQuotes) lines.push(`> "${q}"`, '');
  }

  if (summary.prosAndCons) {
    lines.push('## Pros & Cons', '', '**Pros**', '');
    for (const p of summary.prosAndCons.pros) lines.push(`- ${p}`);
    lines.push('', '**Cons**', '');
    for (const c of summary.prosAndCons.cons) lines.push(`- ${c}`);
    lines.push('');
  }

  if (summary.factCheck) {
    lines.push('## Fact Check', '', summary.factCheck, '');
  }

  if (summary.commentsHighlights && summary.commentsHighlights.length > 0) {
    lines.push('## Comment Highlights', '');
    for (const h of summary.commentsHighlights) lines.push(`- ${h}`);
    lines.push('');
  }

  if (summary.conclusion) {
    lines.push('## Conclusion', '', summary.conclusion, '');
  }

  if (summary.extraSections) {
    for (const [rawTitle, content] of Object.entries(summary.extraSections)) {
      const title = rawTitle.startsWith('[SPOILER] ') ? rawTitle.slice(10) : rawTitle;
      lines.push(`## ${title}`, '', content, '');
    }
  }

  if (summary.relatedTopics.length > 0) {
    lines.push('## Related Topics', '', summary.relatedTopics.map(t => `[${t}](https://www.google.com/search?q=${encodeURIComponent(t)})`).join(' | '), '');
  }

  if (summary.tags.length > 0) {
    lines.push('---', '', summary.tags.map((t) => `#${t}`).join(' '), '');
  }

  if (content?.url) {
    lines.push('---', '', `[Original source](${content.url})`, '');
  }

  lines.push(`*Generated with [xTil](https://xtil.ai)*`);

  return fixMermaidSyntax(lines.join('\n'));
}

export function downloadMarkdown(summary: SummaryDocument, content: ExtractedContent | null) {
  const md = summaryToMarkdown(summary, content);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const slug = (summary.translatedTitle || content?.title || summary.inferredTitle || 'summary').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Convert a live-DOM SVG to PNG by replacing foreignObject elements with SVG <text>,
 *  reading computed styles from the live DOM. foreignObject HTML can't be rendered
 *  via Image+canvas due to browser security restrictions. */
async function svgToPng(liveSvg: SVGSVGElement): Promise<string> {
  // Use the actual on-screen rendered size so the PNG matches the panel
  const rect = liveSvg.getBoundingClientRect();
  const renderW = Math.round(rect.width);
  const renderH = Math.round(rect.height);

  const svgStr = new XMLSerializer().serializeToString(liveSvg);
  const doc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
  const svg = doc.querySelector('svg')!;

  // Force the SVG to render at the on-screen size (overrides viewBox-only sizing)
  svg.setAttribute('width', String(renderW));
  svg.setAttribute('height', String(renderH));

  // Replace foreignObject with SVG <text> using computed styles from the live DOM
  const liveFOs = liveSvg.querySelectorAll('foreignObject');
  const cloneFOs = doc.querySelectorAll('foreignObject');
  for (let i = 0; i < liveFOs.length && i < cloneFOs.length; i++) {
    const fo = cloneFOs[i];
    const liveFO = liveFOs[i];
    const x = parseFloat(fo.getAttribute('x') || '0');
    const y = parseFloat(fo.getAttribute('y') || '0');
    const w = parseFloat(fo.getAttribute('width') || '100');
    const h = parseFloat(fo.getAttribute('height') || '30');

    // Read text content and style from the live DOM element
    const liveEl = liveFO.querySelector('div, span, p') || liveFO;
    const rawText = (liveEl.textContent || '').trim();
    const cs = getComputedStyle(liveEl);
    const fill = cs.color || '#000';
    const fSize = parseFloat(cs.fontSize) || 14;

    const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('x', String(x + w / 2));
    textEl.setAttribute('text-anchor', 'middle');
    textEl.setAttribute('fill', fill);
    textEl.setAttribute('font-size', String(fSize));
    textEl.setAttribute('font-family', cs.fontFamily || 'sans-serif');

    const lines = rawText.split('\n').filter(l => l.trim());
    const lh = fSize * 1.3;
    const startY = y + h / 2 - ((lines.length - 1) * lh) / 2;
    for (let j = 0; j < lines.length; j++) {
      const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspan.setAttribute('x', String(x + w / 2));
      tspan.setAttribute('y', String(startY + j * lh));
      tspan.textContent = lines[j].trim();
      textEl.appendChild(tspan);
    }
    fo.replaceWith(textEl);
  }

  const finalSvg = new XMLSerializer().serializeToString(doc);
  const blob = new Blob([finalSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    const scale = 2; // 2x for retina sharpness
    const canvas = document.createElement('canvas');
    canvas.width = renderW * scale;
    canvas.height = renderH * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, renderW, renderH);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}


/** Convert LaTeX to simplified HTML using <sup>, <sub>, and Unicode math.
 *  Handles the common cases that appear in academic paper summaries.
 *  Google Docs, Gmail, and most rich text editors support this subset. */
function latexToSimpleHtml(tex: string): string {
  let s = tex.trim();

  // Greek letters
  const greek: Record<string, string> = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
    eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
    nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
    upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ',
    Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    varepsilon: 'ε', varphi: 'φ', vartheta: 'ϑ',
  };
  for (const [cmd, ch] of Object.entries(greek)) {
    s = s.replace(new RegExp(`\\\\${cmd}(?![a-zA-Z])`, 'g'), ch);
  }

  // Math operators and symbols
  const symbols: Record<string, string> = {
    '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\infty': '∞',
    '\\partial': '∂', '\\nabla': '∇', '\\forall': '∀', '\\exists': '∃',
    '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\subseteq': '⊆',
    '\\cup': '∪', '\\cap': '∩', '\\emptyset': '∅',
    '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈',
    '\\equiv': '≡', '\\sim': '∼', '\\propto': '∝',
    '\\times': '×', '\\cdot': '·', '\\pm': '±', '\\mp': '∓',
    '\\rightarrow': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒',
    '\\Leftarrow': '⇐', '\\leftrightarrow': '↔', '\\mapsto': '↦',
    '\\ldots': '…', '\\cdots': '⋯', '\\vdots': '⋮',
    '\\langle': '⟨', '\\rangle': '⟩',
    '\\models': '⊨', '\\vDash': '⊨', '\\vdash': '⊢',
    '\\neg': '¬', '\\land': '∧', '\\lor': '∨',
    '\\min': 'min', '\\max': 'max', '\\log': 'log', '\\exp': 'exp',
    '\\sin': 'sin', '\\cos': 'cos', '\\tan': 'tan',
    '\\lim': 'lim', '\\sup': 'sup', '\\inf': 'inf',
    '\\det': 'det', '\\dim': 'dim', '\\arg': 'arg',
  };
  for (const [cmd, ch] of Object.entries(symbols)) {
    s = s.split(cmd).join(ch);
  }

  // Accents: \tilde{x} → x̃, \hat{x} → x̂, \bar{x} → x̄, \dot{x} → ẋ
  s = s.replace(/\\tilde\{([^}])\}/g, '$1\u0303');
  s = s.replace(/\\hat\{([^}])\}/g, '$1\u0302');
  s = s.replace(/\\bar\{([^}])\}/g, '$1\u0304');
  s = s.replace(/\\dot\{([^}])\}/g, '$1\u0307');
  s = s.replace(/\\vec\{([^}])\}/g, '$1\u20D7');
  // Multi-char accent groups: \tilde{abc} → ã b̃ c̃ — just add to first char
  s = s.replace(/\\tilde\{([^}]+)\}/g, '$1\u0303');
  s = s.replace(/\\hat\{([^}]+)\}/g, '$1\u0302');
  s = s.replace(/\\bar\{([^}]+)\}/g, '$1\u0304');

  // \text{...} and \mathrm{...} — just unwrap
  s = s.replace(/\\(?:text|mathrm|textrm|textit|mathit|mathbf|textbf)\{([^}]*)\}/g, '$1');

  // \frac{a}{b} → a/b (or a⁄b with fraction slash)
  s = s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1/$2)');

  // \sqrt{x} → √x, \sqrt[n]{x} → ⁿ√x
  s = s.replace(/\\sqrt\[([^\]]*)\]\{([^}]*)\}/g, '<sup>$1</sup>√($2)');
  s = s.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');

  // Remove \left, \right, \big, \Big, \bigg, \Bigg
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)\s*/g, '');

  // Remove remaining unknown commands (keep their argument if any)
  s = s.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1');
  s = s.replace(/\\[a-zA-Z]+/g, '');

  // Superscripts: ^{...} → <sup>...</sup>, ^x → <sup>x</sup>
  s = s.replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>');
  s = s.replace(/\^([a-zA-Z0-9+\-])/g, '<sup>$1</sup>');

  // Subscripts: _{...} → <sub>...</sub>, _x → <sub>x</sub>
  s = s.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>');
  s = s.replace(/_([a-zA-Z0-9])/g, '<sub>$1</sub>');

  // Clean up remaining LaTeX artifacts
  s = s.replace(/[{}]/g, '');          // stray braces
  s = s.replace(/\\\\/g, '');          // line breaks
  s = s.replace(/\\[,;:!]\s*/g, ' '); // thin spaces
  s = s.replace(/\s{2,}/g, ' ');      // collapse whitespace

  return s.trim();
}

const STORE_URL = 'https://xtil.ai';

export async function copyToClipboard(summary: SummaryDocument, content: ExtractedContent | null, containerEl: HTMLElement | null) {
  const md = summaryToMarkdown(summary, content);

  // Clone rendered DOM to preserve mermaid diagrams, then clean up UI chrome
  let html = md; // fallback
  if (containerEl) {
    const clone = containerEl.cloneNode(true) as HTMLElement;
    // Remove export buttons, dismiss buttons, etc.
    clone.querySelectorAll('.no-print').forEach(el => el.remove());
    // Expand all collapsed sections
    clone.querySelectorAll('.section-content').forEach(el => {
      (el as HTMLElement).style.display = 'block';
    });
    // Convert section toggle buttons to headings
    clone.querySelectorAll('.section-toggle').forEach(btn => {
      const h3 = document.createElement('h3');
      btn.querySelector('span')?.remove();
      h3.textContent = btn.textContent?.trim() || '';
      btn.replaceWith(h3);
    });
    // Temporarily expand collapsed sections in the live DOM so SVGs are measurable
    const liveSections = containerEl.querySelectorAll<HTMLElement>('.section-content');
    const savedDisplay = Array.from(liveSections, el => el.style.display);
    liveSections.forEach(el => { el.style.display = 'block'; });

    // Convert mermaid SVGs to PNG (foreignObject → SVG <text>, then canvas)
    const livePres = containerEl.querySelectorAll('pre.mermaid');
    const clonePres = clone.querySelectorAll('pre.mermaid');
    for (let i = 0; i < livePres.length && i < clonePres.length; i++) {
      const liveSvg = livePres[i].querySelector('svg');
      if (!liveSvg || !clonePres[i]) continue;
      try {
        const pngUrl = await svgToPng(liveSvg as SVGSVGElement);
        const img = document.createElement('img');
        img.src = pngUrl;
        img.alt = 'Diagram';
        img.style.maxWidth = '100%';
        // Preserve auto-generated legend from the clone
        const legendEl = clonePres[i].querySelector('.mermaid-legend');
        if (legendEl) {
          const wrapper = document.createElement('div');
          wrapper.appendChild(img);
          wrapper.appendChild(legendEl);
          clonePres[i].replaceWith(wrapper);
        } else {
          clonePres[i].replaceWith(img);
        }
      } catch {
        clonePres[i].remove();
      }
    }

    // Restore collapsed sections
    liveSections.forEach((el, i) => { el.style.display = savedDisplay[i]; });

    // Replace KaTeX HTML with simplified HTML that Google Docs can render
    // (GDocs strips KaTeX's complex CSS positioning, flattening formulas into garbled text)
    clone.querySelectorAll<HTMLElement>('.katex-display').forEach(display => {
      const annotation = display.querySelector('annotation');
      if (!annotation) return;
      const html = latexToSimpleHtml(annotation.textContent || '');
      const div = document.createElement('div');
      div.style.cssText = 'text-align:center;margin:8px 0;font-size:1.1em;';
      div.innerHTML = html;
      display.replaceWith(div);
    });
    clone.querySelectorAll<HTMLElement>('.katex').forEach(el => {
      const annotation = el.querySelector('annotation');
      if (!annotation) return;
      const html = latexToSimpleHtml(annotation.textContent || '');
      const span = document.createElement('span');
      span.innerHTML = html;
      el.replaceWith(span);
    });

    // Replace Related Topics with a simple comma-separated link list (Google Docs strips inline-block/margin)
    if (summary.relatedTopics.length > 0) {
      const topicSections = clone.querySelectorAll('.section-content');
      // The Related Topics section-content is the last or second-to-last — find it by link pattern
      for (const sc of topicSections) {
        const links = sc.querySelectorAll('a[href*="google.com/search"]');
        if (links.length === 0) continue;
        const p = document.createElement('p');
        links.forEach((a, idx) => {
          if (idx > 0) p.appendChild(document.createTextNode(' \u00b7 '));
          const link = document.createElement('a');
          link.href = (a as HTMLAnchorElement).href;
          link.textContent = a.textContent || '';
          p.appendChild(link);
        });
        sc.innerHTML = '';
        sc.appendChild(p);
      }
    }

    // Replace Tags with a plain-text paragraph
    if (summary.tags.length > 0) {
      // Tags container is the last div with inline-block spans
      const allDivs = clone.querySelectorAll(':scope > div');
      for (const div of allDivs) {
        const spans = div.querySelectorAll('span');
        if (spans.length > 0 && spans[0].textContent?.startsWith('#')) {
          const p = document.createElement('p');
          p.style.color = '#666';
          p.style.fontSize = '13px';
          p.textContent = Array.from(spans, s => s.textContent?.trim()).join('  ');
          div.replaceWith(p);
          break;
        }
      }
    }

    // --- Build header with thumbnail + metadata ---
    const title = summary.translatedTitle || content?.title || summary.inferredTitle || '';
    const author = content?.author || summary.inferredAuthor;
    const date = content?.publishDate || summary.inferredPublishDate;
    let header = '';
    if (content?.thumbnailUrl) {
      header += `<img src="${content.thumbnailUrl}" alt="${title}" style="max-width:100%;border-radius:8px;margin-bottom:8px;" />\n`;
    }
    if (title) header += `<h1>${title}</h1>\n`;
    const metaParts: string[] = [];
    if (author) metaParts.push(`By ${author}`);
    if (date) metaParts.push(formatDate(date));
    if (content?.estimatedReadingTime) metaParts.push(`${content.estimatedReadingTime} min read`);
    if (metaParts.length) header += `<p style="color:#666;font-size:14px;">${metaParts.join(' &middot; ')}</p>\n<hr />\n`;

    // --- Build footer with source link + attribution ---
    let footer = '<hr />\n';
    if (content?.url) {
      footer += `<p><a href="${content.url}">Original source</a></p>\n`;
    }
    footer += `<p style="color:#999;font-size:12px;"><em>Generated with <a href="${STORE_URL}">xTil</a></em></p>`;

    html = header + clone.innerHTML + footer;
  }

  const item = new ClipboardItem({
    'text/plain': new Blob([md], { type: 'text/plain' }),
    'text/html': new Blob([html], { type: 'text/html' }),
  });
  await navigator.clipboard.write([item]);
}

/** Status label → badge color mapping */
const STATUS_BADGES: Record<string, { bg: string; text: string }> = {
  // PR statuses
  'ready to merge': { bg: '#1a7f37', text: '#fff' },
  'needs attention': { bg: '#bf8700', text: '#fff' },
  'blocked':        { bg: '#cf222e', text: '#fff' },
  'open':           { bg: '#57606a', text: '#fff' },
  'merged':         { bg: '#8250df', text: '#fff' },
  'closed':         { bg: '#cf222e', text: '#fff' },
  // Issue statuses
  'has fix':        { bg: '#1a7f37', text: '#fff' },
  'confirmed':      { bg: '#bf8700', text: '#fff' },
  'needs triage':   { bg: '#57606a', text: '#fff' },
  'stale':          { bg: '#57606a', text: '#fff' },
};

/** Known status labels to detect at the start of a status line */
const STATUS_LABELS = Object.keys(STATUS_BADGES).sort((a, b) => b.length - a.length);

/** Split TL;DR text into body and an optional status line (detected by **Status:** pattern) */
function splitTldrStatus(tldr: string): { body: string; statusLabel: string | null; statusText: string | null } {
  // Accept both \n and \n\n before **Status:** (LLMs sometimes use a single newline)
  const match = tldr.match(/\n\n?\*\*Status:\*\*\s*(.*?)$/s);
  if (!match) return { body: tldr, statusLabel: null, statusText: null };

  let rest = match[1].trim();
  // Strip markdown bold/italic wrapping from label: "**Needs attention** — text" → "Needs attention — text"
  rest = rest.replace(/^([*_]{1,2})(.+?)\1(?=\s*[—–\-:]|\s*$)/, '$2').trim();

  // Try to extract a known status label from the beginning
  const lower = rest.toLowerCase();
  for (const label of STATUS_LABELS) {
    if (lower.startsWith(label)) {
      const statusLabel = rest.slice(0, label.length);
      let statusText = rest.slice(label.length).replace(/^\s*[—–\-:]\s*/, '').trim();
      return { body: tldr.slice(0, match.index!).trim(), statusLabel, statusText: statusText || null };
    }
  }
  // No known label — fall back to raw GitHub state words
  const stateMatch = rest.match(/^(Open|Closed|Merged)\s*[—–\-:]\s*/i);
  if (stateMatch) {
    return { body: tldr.slice(0, match.index!).trim(), statusLabel: stateMatch[1], statusText: rest.slice(stateMatch[0].length).trim() || null };
  }
  // Unknown format — show entire text with no badge
  return { body: tldr.slice(0, match.index!).trim(), statusLabel: null, statusText: rest };
}

function StatusBadge({ label, fallbackState }: { label: string | null; fallbackState?: string }) {
  const key = (label || fallbackState || 'open').toLowerCase();
  const c = STATUS_BADGES[key] || STATUS_BADGES.open;
  const display = label || (fallbackState ? fallbackState.charAt(0).toUpperCase() + fallbackState.slice(1) : 'Open');

  return (
    <span style={{
      backgroundColor: c.bg,
      color: c.text,
      padding: '2px 8px',
      borderRadius: '12px',
      font: 'var(--md-sys-typescale-label-small)',
      fontWeight: 600,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {display}
    </span>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}
