# Pie Chart

**Declaration:** `pie`

## Basic Syntax

```
pie title Favorite Pets
    "Dogs" : 45
    "Cats" : 30
    "Birds" : 15
    "Fish" : 10
```

## Structure

### pie keyword
Required. Starts the diagram.

### showData (Optional)
Renders actual data values after legend text:
```
pie showData
    title Favorite Pets
    "Dogs" : 45
    "Cats" : 30
```

### title (Optional)
```
pie title "Your Title Here"
```

### Data Entries
- **Label**: Text in quotation marks
- **Separator**: Colon `:`
- **Value**: Positive numeric value (up to two decimal places)

Slices display clockwise in label order.

## Data Requirements

- Values must be positive numbers greater than zero
- Negative values cause errors
- Supports decimal values up to two places (e.g., `10.50`)
