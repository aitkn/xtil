# Requirement Diagram

**Declaration:** `requirementDiagram`

## Core Components

### Requirement Definition

```
<type> user_defined_name {
    id: user_defined_id
    text: user_defined text
    risk: <risk>
    verifymethod: <method>
}
```

**Type options:**
- `requirement`
- `functionalRequirement`
- `interfaceRequirement`
- `performanceRequirement`
- `physicalRequirement`
- `designConstraint`

**Risk levels:** `Low`, `Medium`, `High`

**Verification methods:** `Analysis`, `Inspection`, `Test`, `Demonstration`

### Element Definition

```
element user_defined_name {
    type: user_defined_type
    docref: user_defined_ref
}
```

### Relationships

```
{source_name} - <type> -> {destination_name}
{destination_name} <- <type> - {source_name}
```

**Relationship types:**
- `contains`
- `copies`
- `derives`
- `satisfies`
- `verifies`
- `refines`
- `traces`

## Example

```
requirementDiagram

    requirement test_req {
        id: 1
        text: "the test text."
        risk: high
        verifymethod: test
    }

    functionalRequirement test_req2 {
        id: 1.1
        text: "the second test text."
        risk: low
        verifymethod: inspection
    }

    performanceRequirement test_req3 {
        id: 1.2
        text: "the third test text."
        risk: medium
        verifymethod: demonstration
    }

    element test_entity {
        type: simulation
        docref: ref_doc_01
    }

    test_entity - satisfies -> test_req2
    test_req - traces -> test_req2
    test_req - contains -> test_req3
    test_req3 <- derives - test_req2
    test_entity - verifies -> test_req3
```

## Direction

```
requirementDiagram
    direction LR
```

Options: `TB` (default), `BT`, `LR`, `RL`

## Markdown Formatting

User-defined text supports markdown: `"**bold** and *italics*"`
