# Quadrant Chart

**Declaration:** `quadrantChart`

## Basic Syntax

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

## Structure

### Title
```
quadrantChart
    title This is a sample example
```

### X-Axis
- Both labels: `x-axis Low Effort --> High Effort`
- Left only: `x-axis Low Effort`

### Y-Axis
- Both labels: `y-axis Low Impact --> High Impact`
- Bottom only: `y-axis Low Impact`

### Quadrant Labels
- `quadrant-1`: top right
- `quadrant-2`: top left
- `quadrant-3`: bottom left
- `quadrant-4`: bottom right

### Data Points
`Point Name: [x, y]` where x and y range from 0 to 1.
