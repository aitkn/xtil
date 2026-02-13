# Flowchart

**Declaration:** `flowchart <direction>` (or `graph <direction>`)

## Directions

- **TB** or **TD**: Top to bottom (default)
- **BT**: Bottom to top
- **LR**: Left to right
- **RL**: Right to left

```
flowchart LR
    A --> B
```

## Node Shapes

### Classic Syntax

```
id            %% rectangle (default), displays "id"
id[text]      %% rectangle with text
id(text)      %% rounded rectangle
id([text])    %% stadium / pill
id[[text]]    %% subroutine
id[(text)]    %% cylinder / database
id((text))    %% circle
id>text]      %% asymmetric / flag
id{text}      %% diamond / rhombus
id{{text}}    %% hexagon
id[/text/]    %% parallelogram
id[\text\]    %% parallelogram alt
id[/text\]    %% trapezoid
id[\text/]    %% trapezoid alt
id(((text)))  %% double circle
```

### Expanded Node Shapes (v11.3.0+)

Use generic syntax: `A@{ shape: shapeName, label: "Text" }`

Key shape names: `rect`, `rounded`, `stadium`, `circle`, `sm-circ`, `dbl-circ`, `fr-circ`, `diam`, `hex`, `odd`, `lean-r`, `lean-l`, `trap-t`, `trap-b`, `cyl`, `h-cyl`, `lin-cyl`, `doc`, `docs`, `lin-doc`, `tag-doc`, `notch-rect`, `fr-rect`, `div-rect`, `lin-rect`, `st-rect`, `tag-rect`, `sl-rect`, `bow-rect`, `cloud`, `delay`, `fork`, `f-circ`, `cross-circ`, `hourglass`, `bolt`, `brace`, `brace-r`, `braces`, `tri`, `flip-tri`, `notch-pent`, `flag`, `win-pane`, `text`, `bang`, `curv-trap`

Examples:
```
flowchart TD
    A@{ shape: rect, label: "Process" }
    B@{ shape: cyl, label: "Database" }
    C@{ shape: diam, label: "Decision" }
    D@{ shape: cloud, label: "Cloud" }
    E@{ shape: doc, label: "Document" }
    F@{ shape: hex, label: "Hexagon" }
```

### Icon Shape
```
flowchart TD
    A@{ shape: icon, icon: "fa:fa-twitter", form: "square", label: "Twitter", pos: "b", h: 48 }
```
Parameters: `icon` (icon name), `form` (`square`/`circle`/`rounded`), `label`, `pos` (`t`/`b`), `h` (height, default 48)

### Image Shape
```
flowchart TD
    A@{ img: "https://example.com/image.png", label: "Image", pos: "t", w: 60, h: 60, constraint: "off" }
```
Parameters: `img` (URL), `label`, `pos` (`t`/`b`), `w` (width), `h` (height), `constraint` (`on`/`off`)

## Edges / Links

```
A --> B        %% arrow
A --- B        %% line (no arrow)
A -.- B        %% dotted line
A -.-> B       %% dotted arrow
A ==> B        %% thick arrow
A === B        %% thick line
A ~~~ B        %% invisible link
A --text--> B  %% arrow with text (inline)
A -->|text| B  %% arrow with text (pipe)
A o--o B       %% circle endpoints
A x--x B       %% cross endpoints
A <--> B       %% bidirectional
```

### Link Length

Add extra dashes to make links longer:

| Style    | Len 1 | Len 2  | Len 3   |
|----------|-------|--------|---------|
| Normal   | `---` | `----` | `-----` |
| Arrow    | `-->` | `--->` | `---->` |
| Thick    | `===` | `====` | `=====` |
| Thick->  | `==>` | `===>` | `====>` |
| Dotted   | `-.-` | `-..-` | `-...-` |
| Dotted-> | `-.->` | `-..->` | `-...->` |

## Chaining

```
A --> B --> C          %% chain
A --> B & C --> D      %% fan-out and fan-in
A & B --> C & D        %% all-to-all
```

## Subgraphs

```
subgraph id [Title]
  direction LR
  A --> B
end
C --> id          %% link to subgraph
```

Note: If subgraph nodes link outside, subgraph direction is ignored.

## Markdown Strings

```
flowchart TD
    A["`**Bold** and *italic*`"]
    B["`Line 1
    Line 2`"]
```

## FontAwesome Icons

```
flowchart TD
    B["fa:fa-twitter for Twitter"]
```

Supported prefixes: `fa`, `fab`, `fas`, `far`, `fal`, `fad`

## Comments

```
%% This is a comment
```

## Warnings

- Avoid lowercase `end` in node names — use `"end"`, `End`, `[end]`
- If node starts with `o` or `x`, add space or capitalize (e.g., `dev--- ops` not `A---oB`)
- Subgraph direction is overridden when subgraph nodes link outside
