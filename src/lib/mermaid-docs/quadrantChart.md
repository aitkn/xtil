# Quadrant Chart

**Declaration:** `quadrantChart`

## Comprehensive Example

```
quadrantChart
    title Skills Assessment
    x-axis Low Effort --> High Effort
    y-axis Low Impact --> High Impact
    quadrant-1 Do First
    quadrant-2 Schedule
    quadrant-3 Delegate
    quadrant-4 Eliminate
    Campaign A: [0.3, 0.6]
    Campaign B: [0.7, 0.8]
    Campaign C: [0.5, 0.2]
```

**Required:**
- `quadrantChart` declaration
- At least one data point: `Name: [x, y]` where x and y range from 0 to 1

**Optional:**
- `title` — chart title
- `x-axis Low --> High` — labels for both ends (or left only: `x-axis Low`)
- `y-axis Low --> High` — labels for both ends (or bottom only: `y-axis Low`)
- `quadrant-1` through `quadrant-4` — custom quadrant labels

## Quadrant Numbering

- `quadrant-1`: top right
- `quadrant-2`: top left
- `quadrant-3`: bottom left
- `quadrant-4`: bottom right
