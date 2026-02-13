# Block Diagram

**Declaration:** `block-beta`

## Basic Syntax

```
block-beta
    columns 3
    a["Frontend"] b["API"] c["Database"]
    d["Cache"]:2 e["Queue"]
    space f["Worker"]:2
```

## Columns

`columns N` sets the grid width. Each block spans 1 column by default.

```
block-beta
    columns 3
    a b c
    d e f
```

### Column Spanning

`block:N` spans N columns:
```
block-beta
    columns 3
    a:1 b:2
    c:2 d:1
```

### Vertical Stacking

```
block-beta
    columns 1
    a b c d
```

## Block Shapes

```
a["Rectangle"]      %% default rectangle
a(["Stadium"])       %% stadium/pill
a[["Subroutine"]]   %% subroutine
a[(Database)]        %% cylinder
a((Circle))          %% circle
a>Asymmetric]        %% asymmetric
a{Decision}          %% rhombus/diamond
a{{Hexagon}}         %% hexagon
a[/"Parallelogram"/] %% parallelogram
a[/"Trapezoid"\]     %% trapezoid
a((("Double circle"))) %% double circle
```

### Block Arrow

```
a=>"Block arrow"]
```

### Space (Empty Cell)

```
block-beta
    columns 3
    a space b
    space:2 c
```

`space` defaults to 1 column; `space:N` spans N columns.

## Nested / Composite Blocks

```
block-beta
    columns 2
    block:2
        columns 2
        a b
    end
    c d
```

## Edges / Links

Links are placed after block definitions (same syntax as flowchart):

```
block-beta
    columns 3
    a["Frontend"] b["API"] c["Database"]
    a --> b
    b --> c
```

### Link Types

```
a --> b        %% arrow
a --- b        %% line (no arrow)
a -->|Label| b %% arrow with text
```

## Comments

```
%% This is a comment
```
