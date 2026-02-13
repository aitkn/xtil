# User Journey Diagram

**Declaration:** `journey`

## Comprehensive Example

```
journey
    title Customer Purchase Flow
    section Discovery
        Visit website: 4: Customer
        Browse products: 3: Customer
        Read reviews: 4: Customer
    section Purchase
        Add to cart: 5: Customer
        Enter payment: 2: Customer, System
        Confirm order: 4: Customer, System
    section Delivery
        Track shipment: 3: Customer
        Receive package: 5: Customer, Courier
```

**Required:**
- `journey` declaration
- At least one task in format `Task name: score: actors`

**Optional:**
- `title` — diagram title
- `section` — groups related tasks visually

## Task Format

```
Task name: <score>: <comma separated list of actors>
```

- **Task name**: Description of the step
- **Score**: Numeric value 1-5 (1 = bad, 5 = great)
- **Actors**: Comma-separated list of participants

## Sections

Sections group related tasks:
```
section Section Name
    Task1: score: actors
    Task2: score: actors
```
