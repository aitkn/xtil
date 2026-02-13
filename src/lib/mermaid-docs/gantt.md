# Gantt Chart

**Declaration:** `gantt`

## Basic Structure

```
gantt
    title Project Plan
    dateFormat YYYY-MM-DD
    axisFormat %m/%d
    excludes weekends
    todayMarker on

    section Planning
        Research        :done, a1, 2024-01-01, 2024-01-15
        Requirements    :active, a2, after a1, 10d

    section Development
        Design          :crit, des1, 2024-01-20, 15d
        Coding          :des2, after des1, 30d
        Testing         :des3, after des2, 2024-04-01

    section Release
        Deploy          :milestone, m1, 2024-04-01, 0d
```

## Task Format

`Title :metadata, id, start, end_or_duration`

### Metadata Tags

- `done` - Completed task
- `active` - Currently active task
- `crit` - Critical path task
- `milestone` - Single point in time

### Start Options

- Date: `2024-01-01`
- After dependency: `after taskId1`
- After multiple: `after taskId1 taskId2`

### End Options

- Date: `2024-01-15`
- Duration: `10d`, `1w`, `2h`
- Until another task: `until taskId` (v10.9.0+)

### Full Metadata Syntax Table

| Format | Start | End | ID |
|--------|-------|-----|-----|
| `id, startDate, endDate` | Date | Date | Yes |
| `id, startDate, length` | Date | Start + length | Yes |
| `id, after otherId, endDate` | Other end | Date | Yes |
| `id, after otherId, length` | Other end | Start + length | Yes |
| `id, startDate, until otherId` | Date | Other start | Yes |
| `id, after otherId, until otherId` | Other end | Other start | Yes |
| `startDate, endDate` | Date | Date | No |
| `startDate, length` | Date | Start + length | No |
| `after otherId, length` | Other end | Start + length | No |
| `length` | Previous end | Start + length | No |

## Date Configuration

### Input Date Format (dateFormat)

Default: `YYYY-MM-DD`

| Input | Example | Description |
|-------|---------|-------------|
| YYYY | 2024 | 4-digit year |
| YY | 24 | 2-digit year |
| MM | 01-12 | Month number |
| DD | 01-31 | Day of month |
| HH | 00-23 | 24-hour |
| mm | 00-59 | Minutes |
| ss | 00-59 | Seconds |
| X | 1410715640.579 | Unix timestamp |
| x | 1410715640579 | Unix ms |

### Output Date Format (axisFormat)

Default: `YYYY-MM-DD`

| Format | Definition |
|--------|-----------|
| %a | Abbreviated weekday |
| %A | Full weekday |
| %b | Abbreviated month |
| %B | Full month |
| %d | Zero-padded day [01,31] |
| %e | Space-padded day |
| %H | Hour 24h [00,23] |
| %I | Hour 12h [01,12] |
| %m | Month [01,12] |
| %M | Minute [00,59] |
| %p | AM or PM |
| %Y | Full year |
| %% | Literal "%" |

### Axis Ticks (v10.3.0+)

`tickInterval 1week`

Pattern: `/^([1-9][0-9]*)(millisecond|second|minute|hour|day|week|month)$/`

## Excludes

```
excludes weekends
excludes 2024-01-01, 2024-12-25
excludes sunday
```

### Weekend Configuration (v11.0.0+)

```
weekend friday    %% friday+saturday
weekend saturday  %% saturday+sunday (default)
```

## Sections

```
section Section Name
```

Section names are mandatory.

## Milestones

```
Deploy :milestone, m1, 2024-04-01, 0d
```

Position: initial date + duration/2

## Vertical Markers

```
Deploy :vert, v1, 2024-04-01, 0d
```

## Today Marker

Hide: `todayMarker off`

## Comments

```
%% This is a comment
```
