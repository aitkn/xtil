# Pie Chart

**Declaration:** `pie`

## Comprehensive Example

```
pie showData
    title Favorite Pets
    "Dogs" : 45
    "Cats" : 30
    "Birds" : 15
    "Fish" : 10
```

**Required:**
- `pie` declaration
- At least one data entry: `"Label" : value`

**Optional:**
- `showData` — renders actual values after legend text
- `title` — chart title

## Data Entries

- **Label**: Text in double quotes
- **Value**: Positive numeric (up to two decimal places, e.g. `10.50`)
- Slices display clockwise in label order
