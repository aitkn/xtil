/**
 * Attempt to repair common JSON issues produced by LLMs:
 * - Trailing commas before } or ]
 * - Unescaped double quotes inside string values
 * - Unescaped control characters (newlines, tabs) in strings
 */
export function repairJson(raw: string): string {
  // Fix trailing commas: ,] or ,}
  let s = raw.replace(/,(\s*[}\]])/g, '$1');

  try {
    JSON.parse(s);
    return s;
  } catch { /* needs deeper repair */ }

  // Fix unescaped double quotes and control chars inside string values
  const chars: string[] = [];
  let inString = false;
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (!inString) {
      chars.push(ch);
      if (ch === '"') inString = true;
      i++;
    } else {
      if (ch === '\\') {
        // Escaped character — keep both chars
        chars.push(ch);
        if (i + 1 < s.length) {
          chars.push(s[i + 1]);
          i += 2;
        } else {
          i++;
        }
      } else if (ch === '"') {
        // Is this the end of the string, or an unescaped interior quote?
        // Look ahead past whitespace to determine.
        let j = i + 1;
        while (j < s.length && ' \t\r\n'.includes(s[j])) j++;
        const next = j < s.length ? s[j] : '';

        if (next === ':' || next === ',' || next === '}' || next === ']' || next === '') {
          // Legitimate string terminator
          chars.push('"');
          inString = false;
        } else {
          // Interior unescaped quote — escape it
          chars.push('\\"');
        }
        i++;
      } else if (ch === '\n') {
        chars.push('\\n');
        i++;
      } else if (ch === '\r') {
        chars.push('\\r');
        i++;
      } else if (ch === '\t') {
        chars.push('\\t');
        i++;
      } else {
        chars.push(ch);
        i++;
      }
    }
  }

  return chars.join('');
}

/** Find the index of the closing `}` that matches the opening `{` at `start`. */
export function findMatchingBrace(raw: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Try JSON.parse, falling back to repairJson if it fails. */
export function parseJsonSafe(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch { /* try repair */ }

  try {
    return JSON.parse(repairJson(raw));
  } catch {
    return null;
  }
}
