# Kanban Diagram

**Declaration:** `kanban`

## Basic Syntax

```
kanban
    Todo
        task1[Design mockups]
        task2[Write specs]
    In Progress
        task3[Implement API]
    Done
        task4[Setup CI/CD]
```

## Columns

Columns represent workflow stages. Syntax: `columnId[Column Title]`

```
kanban
    id1[Todo]
        ...tasks...
    id2[In Progress]
        ...tasks...
    id3[Done]
        ...tasks...
```

## Tasks

Tasks appear indented under their parent column. Syntax: `taskId[Task Description]`

```
kanban
    Todo
        docs[Create Documentation]
        api[Design API endpoints]
```

**Proper indentation is crucial** - tasks must be indented under their parent columns.

## Task Metadata

Add context with `@{ ... }` syntax:

```
kanban
    Todo
        task1[Design mockups]@{ assigned: "Alice", ticket: "PROJ-1", priority: "High" }
        task2[Write specs]@{ assigned: "Bob", ticket: "PROJ-2", priority: "Low" }
    In Progress
        task3[Implement API]@{ assigned: "Charlie", ticket: "PROJ-3", priority: "Very High" }
```

### Supported Metadata Keys

| Key | Description | Values |
|-----|-------------|--------|
| `assigned` | Person responsible | Any string |
| `ticket` | Links to ticket/issue | Ticket number |
| `priority` | Task urgency | `Very High`, `High`, `Low`, `Very Low` |

## Important Notes

- All identifiers must be unique throughout the diagram
- Indentation determines parent-child relationships
- Metadata renders on the task node
