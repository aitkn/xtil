# Treemap Diagram

**Declaration:** `treemap-beta`

## Basic Syntax

```
treemap-beta
    "Section 1"
        "Leaf 1.1": 12
        "Section 1.2"
            "Leaf 1.2.1": 12
    "Section 2"
        "Leaf 2.1": 20
        "Leaf 2.2": 25
```

## Node Rules

- **Parent nodes**: Quoted text `"Section Name"` (no value)
- **Leaf nodes**: Quoted text with colon and value `"Leaf Name": value`
- **Hierarchy**: Created through indentation (spaces or tabs)

## Example

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

## Limitations

- Works best with natural hierarchies
- Tiny values may be hard to see/label
- Deep hierarchies challenge clarity
- Not suited for negative values
