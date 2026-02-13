# State Diagram

**Declaration:** `stateDiagram-v2`

## States

### Basic States

```
stateDiagram-v2
    [*] --> Still            %% start
    Still --> [*]            %% end
    Still --> Moving
    Moving --> Still
    Moving --> Crash
    Crash --> [*]
```

### State with Description

```
state "This is a state" as s1
s1 --> s2
```

### State with Colon Notation

```
Still: The car is not moving
Moving: The car is moving
```

## Transitions

```
State1 --> State2
State1 --> State2 : event / action
```

## Start and End States

Use `[*]` syntax. Arrow direction determines if it's start or end:

```
[*] --> FirstState      %% start
FirstState --> [*]      %% end
```

## Composite States

```
state Active {
    [*] --> Running
    Running --> Paused
    Paused --> Running
}
```

### Nested Composite States

```
state First {
    [*] --> Second
    state Second {
        [*] --> DeepNested
        DeepNested --> [*]
    }
    Second --> [*]
}
```

### Transitions Between Composite States

```
state Composite1 {
    [*] --> StateA
}
state Composite2 {
    [*] --> StateB
}
Composite1 --> Composite2
```

Constraint: Cannot define transitions between internal states of different composite states.

## Choice

```
state Choice <<choice>>
State1 --> Choice
Choice --> State2 : if condition
Choice --> State3 : else
```

## Fork / Join

```
state Fork <<fork>>
state Join <<join>>
State1 --> Fork
Fork --> Path1
Fork --> Path2
Path1 --> Join
Path2 --> Join
Join --> FinalState
```

## Concurrency

Use `--` to separate concurrent regions:

```
state Active {
    [*] --> Thread1
    --
    [*] --> Thread2
}
```

## Notes

```
note right of State1
    This is a note
    on the right
end note

note left of State2
    This is a note
    on the left
end note
```

Position options: `left of`, `right of`

## Direction

```
stateDiagram-v2
    direction LR
```

Options: `LR`, `RL`, `TB`, `BT`

## States with Spaces

Use state ID with description:

```
yswsii: Your state with spaces in it
[*] --> yswsii
```

## Comments

```
%% This is a comment
[*] --> State1  %% inline comment
```
