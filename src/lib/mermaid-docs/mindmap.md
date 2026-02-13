# Mindmap

**Declaration:** `mindmap`

## Basic Syntax

Uses **indentation** (spaces, not tabs) for hierarchy:

```
mindmap
    root((Central Topic))
        Topic A
            Subtopic A1
            Subtopic A2
        Topic B
            Subtopic B1
        Topic C
```

## Indentation Rules

- Only relative indentation matters (not absolute spacing)
- When ambiguous, parser selects nearest ancestor with smaller indentation
- **Use spaces only** - tabs will break the diagram

Example with unclear indentation:
```
mindmap
    Root
        A
            B
          C
```
C becomes a sibling of B under A (nearest smaller indentation).

## Node Shapes

```
mindmap
    id                %% default shape
    id[Square]        %% square
    id(Rounded)       %% rounded square
    id((Circle))      %% circle
    id))Bang((        %% bang / exclamation
    id)Cloud(         %% cloud
    id{{Hexagon}}     %% hexagon
```

## Icons

Add icons using `::icon()` syntax (requires icon font integration):

```
mindmap
    Root
        Node::icon(fa fa-book)
        Another::icon(material-design-class)
```

This feature is experimental.

## Markdown Strings

Supports bold, italics, and automatic text wrapping:

```
mindmap
    Root
        **Bold text** and *italics*
        Text wraps automatically when too long
```

- Bold: `**text**`
- Italic: `*text*`
- Newlines work directly (no `<br>` needed)
