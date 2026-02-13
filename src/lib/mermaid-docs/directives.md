# Directives & Text Formatting

## Comments

```
%% This is a comment — ignored by the parser
A --> B %% inline comment
```

**Warning:** Avoid curly braces `{}` inside `%%` comments — they confuse the parser.

## Text Formatting

### HTML Entities
```
#amp;   → &
#lt;    → <
#gt;    → >
#35;    → #
#59;    → ; (use in sequence diagram messages)
#quot;  → "
```

### Markdown in Labels (backtick syntax)
```
flowchart TD
    A["`**Bold** and *italic*`"]
```

### Line Breaks
- In labels: `<br>` or `<br/>`
- In markdown strings: actual newlines work

## Diagram-Breaking Gotchas

1. **`end`** — Reserved word. Always wrap: `"end"`, `(end)`, `[end]`, `End`
2. **Misspelled keywords** — Break the diagram silently
3. **Curly braces in comments** — `%%{...}%%` looks like a directive
4. **Nodes inside nodes** — Use quotes to prevent parsing confusion
