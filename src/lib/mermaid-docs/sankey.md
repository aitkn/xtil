# Sankey Diagram

**Declaration:** `sankey-beta`

## Basic Syntax

CSV-like format with exactly 3 columns (source, target, value):

```
sankey-beta

Agricultural "waste",Bio-energy,124.729
Bio-energy,Electricity grid,26.862
Bio-energy,Losses,3.5
Bio-energy,Industry,10.0
Oil,Industry,50.0
Oil,Transport,100.0
```

## CSV Format

Follows RFC 4180 with key differences:
- Requires exactly 3 columns: source, target, value
- Empty lines (without commas) are permitted for visual organization
- Commas within double-quoted values are supported
- Escaped quotes use doubling: `""`
