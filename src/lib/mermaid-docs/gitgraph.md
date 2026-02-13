# GitGraph Diagram

**Declaration:** `gitGraph`

## Basic Syntax

```
gitGraph
    commit
    commit
    branch develop
    checkout develop
    commit
    commit
    checkout main
    merge develop
    commit
    branch feature
    commit
    checkout main
    merge feature tag:"v1.0"
```

## Core Operations

### commit
```
commit                          %% auto-generated ID
commit id: "abc123"            %% custom ID
commit id: "fix" msg: "Bug fix" %% custom message
commit type: HIGHLIGHT         %% commit type
commit tag: "v1.0"             %% tag
```

**Commit types:** `NORMAL` (solid circle), `REVERSE` (crossed circle), `HIGHLIGHT` (filled rectangle)

### branch
```
branch develop                 %% create and switch to branch
branch "feature/login"         %% quoted for special chars
branch develop order: 1        %% with ordering
```

### checkout / switch
```
checkout develop               %% switch to existing branch
switch develop                 %% alias for checkout
```

### merge
```
merge develop                                    %% basic merge
merge develop id: "my_id" tag: "v1.0"           %% with ID and tag
merge develop id: "id" tag: "tag" type: REVERSE  %% with all options
```

Merge creates a filled double circle commit.

### cherry-pick
```
cherry-pick id: "commit_id"
```

Requirements:
1. Target commit must exist
2. Commit cannot already be on current branch
3. Current branch needs at least one commit
4. For merge commits, parent ID is mandatory

## Orientation (v10.3.0+)

```
gitGraph LR:     %% left to right (default)
gitGraph TB:     %% top to bottom
gitGraph BT:     %% bottom to top (v11.0.0+)
```

## Branch Ordering

```
gitGraph
    commit
    branch develop order: 1
    branch feature order: 2
    branch hotfix order: 3
```

Precedence: main branch (order 0) > unordered branches > ordered branches by value
