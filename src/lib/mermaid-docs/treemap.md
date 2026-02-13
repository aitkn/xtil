# Treemap Diagram

**Declaration:** `treemap-beta`

## Comprehensive Example

```
treemap-beta
    "Company Revenue"
        "Products"
            "Widget A": 300
            "Widget B": 200
            "Widget C": 100
        "Services"
            "Consulting": 250
            "Support": 150
```

**Required:**
- `treemap-beta` declaration
- At least one leaf node with a value

**Node rules:**
- **Parent nodes**: Quoted text, no value — `"Section Name"`
- **Leaf nodes**: Quoted text with colon and value — `"Leaf Name": 300`
- **Hierarchy**: Created through indentation (spaces or tabs)

## Limitations

- Works best with natural hierarchies
- Tiny values may be hard to see/label
- Deep hierarchies challenge clarity
- Not suited for negative values
