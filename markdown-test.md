# Comprehensive Markdown Test

This document tests all major Markdown features supported by Dark Harness.

## Headings

### Level 3 Heading
#### Level 4 Heading
##### Level 5 Heading
###### Level 6 Heading

### Setext-style Headings

Main Heading
============

Sub Heading
-----------

## Text Formatting

**Bold text** and *italic text* and ***bold italic***

`inline code` and ~~strikethrough~~

## Code Blocks

```typescript
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
```

```bash
#!/bin/bash
echo "Hello from bash"
ls -la /tmp
```

```json
{
  "name": "dark-harness",
  "version": "0.1.0",
  "type": "module"
}
```

## Lists

### Unordered Lists

- Item 1
- Item 2
  - Nested item 2a
  - Nested item 2b
- Item 3

### Ordered Lists

1. First item
2. Second item
   1. Nested 2.1
   2. Nested 2.2
3. Third item

### Mixed Lists

- Feature A
  1. Implementation step 1
  2. Implementation step 2
- Feature B
  - Sub-feature B1
  - Sub-feature B2

## Blockquotes

> This is a blockquote.
> It can span multiple lines.

> Nested blockquotes work too:
> 
> > This is a nested blockquote
> > with multiple lines

## Links and Images

[Inline link to GitHub](https://github.com)

[Link with title](https://github.com "GitHub")

### Reference-style Links

This is a [reference link][ref-github] and another [one][ref-docs].

[ref-github]: https://github.com
[ref-docs]: https://docs.github.com

## Tables

### Basic Table

| Name | Age | City |
| --- | --- | --- |
| Alice | 28 | New York |
| Bob | 35 | San Francisco |
| Carol | 32 | Seattle |

### Table with Alignment

| Left | Center | Right |
| :--- | :---: | ---: |
| Left-aligned | Centered | Right-aligned |
| Item A | Item B | Item C |
| 100 | 200 | 300 |

### Complex Table

| Feature | Status | Notes |
| --- | --- | --- |
| Tables | ✅ | GFM table support |
| Reference links | ✅ | `[text][ref]` syntax |
| Setext headings | ✅ | Underline-style headings |
| Code blocks | ✅ | With language syntax highlighting |
| Blockquotes | ✅ | Including nested quotes |

## Thematic Break

---

## Special Elements

### Inline HTML (if supported)

HTML tags like <span style="color: red;">inline styles</span> may or may not render.

### Escaped Characters

These characters are escaped: \* \_ \[ \] \( \) \# \+ \- \. \!

### Hard Breaks and Soft Breaks

This is a line with a hard break  
(two spaces before line break)

This is a soft break
in the same paragraph.

## Deep Nesting Test

1. Level 1
   - Bullet A
     > Nested blockquote at level 2
     > 
     > | Nested | Table |
     > | --- | --- |
     > | Data | Here |
   - Bullet B
2. Level 2
   1. Sub 2.1
      - Another nested item
   2. Sub 2.2

## Edge Cases

### Empty Elements

- 
-  

### Very Long Lines

This is a very long line that might wrap depending on terminal width. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

### Special Characters in Tables

| Char | Symbol | Code |
| --- | --- | --- |
| Pipe | \| | `\|` |
| Bracket | [ ] | `\[\]` |
| Asterisk | * | `\*` |

## End of Test

This comprehensive test covers all major Markdown features. Use this to verify rendering in both TUI and Web UI.
