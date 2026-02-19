import type { ContentExtractor, ExtractedContent } from './types';

export const gmailExtractor: ContentExtractor = {
  canExtract(url: string, doc: Document): boolean {
    if (new URL(url).hostname !== 'mail.google.com') return false;
    // At least one visible email body must be present
    const bodies = doc.querySelectorAll('.a3s.aiL');
    for (const body of bodies) {
      if (body instanceof HTMLElement && body.offsetHeight > 0) return true;
    }
    return false;
  },

  extract(url: string, doc: Document): ExtractedContent {
    const subject = doc.querySelector('.hP')?.textContent?.trim() || '';
    const messages = extractThread(doc);

    let content = '';
    if (subject) content += `# ${subject}\n\n`;

    if (messages.length === 1) {
      const msg = messages[0];
      if (msg.sender) content += `**From:** ${msg.sender}\n`;
      if (msg.date) content += `**Date:** ${msg.date}\n`;
      if (msg.sender || msg.date) content += '\n';
      content += msg.body;
    } else {
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const senderLine = msg.sender || 'Unknown';
        const dateLine = msg.date ? ` — ${msg.date}` : '';
        content += `**From: ${senderLine}**${dateLine}\n\n`;
        content += msg.body;
        if (i < messages.length - 1) content += '\n\n---\n\n';
      }
    }

    const firstSender = messages[0]?.sender || undefined;
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    return {
      type: 'gmail',
      url,
      title: subject || 'Gmail Email',
      author: firstSender,
      language: doc.documentElement.lang || undefined,
      content,
      wordCount,
      estimatedReadingTime: Math.ceil(wordCount / 200),
    };
  },
};

interface GmailMessage {
  sender: string | null;
  date: string | null;
  body: string;
}

function extractThread(doc: Document): GmailMessage[] {
  const messages: GmailMessage[] = [];

  // Each .gs is a message segment in a thread
  const segments = doc.querySelectorAll('.gs');
  for (const seg of segments) {
    const body = seg.querySelector('.a3s.aiL');
    if (!(body instanceof HTMLElement) || body.offsetHeight === 0) continue;

    const senderEl = seg.querySelector('.gD');
    const sender = formatSender(senderEl);

    const dateEl = seg.querySelector('.g3');
    const date = dateEl?.getAttribute('title') || null;

    messages.push({
      sender,
      date,
      body: body.innerText.trim(),
    });
  }

  // Fallback: if no .gs segments found, grab all visible bodies directly
  if (messages.length === 0) {
    const bodies = doc.querySelectorAll('.a3s.aiL');
    for (const body of bodies) {
      if (!(body instanceof HTMLElement) || body.offsetHeight === 0) continue;
      messages.push({
        sender: null,
        date: null,
        body: body.innerText.trim(),
      });
    }
  }

  return messages;
}

function formatSender(el: Element | null): string | null {
  if (!el) return null;
  const name = el.getAttribute('name') || el.textContent?.trim() || null;
  const email = el.getAttribute('email');
  if (name && email) return `${name} <${email}>`;
  return name || email || null;
}
