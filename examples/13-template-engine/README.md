# Template Engine (REQUIREMENTS)

**Status:** ⚠️ **BLOCKED** - Missing string interpolation or template function
**Complexity:** Intermediate
**Category:** Text Processing, String Manipulation

## Overview

Simple template engine for rendering text with variable substitution. Useful for generating HTML, emails, config files.

## Required Language Features

### Option 1: String Interpolation (PREFERRED)

```clarity
// Syntax support for string interpolation
let name = "Alice";
let age = 30;
let message = "Hello ${name}, you are ${age} years old!";
// Result: "Hello Alice, you are 30 years old!"
```

### Option 2: Template Function

```clarity
type Map<K, V>

function template_render(tmpl: String, vars: Map<String, String>) -> String

// Example:
let tmpl = "Hello {{name}}, you are {{age}} years old!";
let vars = map_new();
let vars2 = map_set(vars, "name", "Alice");
let vars3 = map_set(vars2, "age", "30");
let result = template_render(tmpl, vars3);
// Result: "Hello Alice, you are 30 years old!"
```

## Example Use Case

HTML email template:

```clarity
effect[FileSystem, Log] function send_welcome_email(name: String, email: String) -> Unit {
  let template = read_file("templates/welcome.html");

  let vars = map_new();
  let vars2 = map_set(vars, "name", name);
  let vars3 = map_set(vars2, "email", email);
  let vars4 = map_set(vars3, "year", "2026");

  let html = template_render(template, vars4);

  // Send email (requires Network effect with email support)
  print_string(html)
}
```

**template/welcome.html:**
```html
<html>
<body>
  <h1>Welcome {{name}}!</h1>
  <p>Your email is: {{email}}</p>
  <footer>Copyright {{year}}</footer>
</body>
</html>
```

## Learning Objectives

- String interpolation
- Template parsing and variable substitution
- Map usage for template variables
- Text generation

## Dependencies

**Option 1:**
- ❌ String interpolation syntax `${var}` (PREFERRED)

**Option 2:**
- ❌ Map type
- ❌ String split/replace operations
- ⚠️ Regex for finding {{var}} patterns

## Impact

String interpolation is a quality-of-life feature that makes string construction much cleaner:

**Without:**
```clarity
"Hello " ++ name ++ ", you are " ++ int_to_string(age) ++ " years old!"
```

**With:**
```clarity
"Hello ${name}, you are ${age} years old!"
```
