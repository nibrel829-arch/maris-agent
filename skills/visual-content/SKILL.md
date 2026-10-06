---
name: visual-content
description: >-
  Visual communication concept design. Use this skill when the request asks for
  a visual concept, asset list, layout message hierarchy, format plan, or
  accessibility review for content. It produces a specification for visuals —
  it does not claim to render images or publish assets, and it does not replace
  human design work.
tools:
  - create_visual_concept
  - list_visual_concepts
  - log_activity
work_types:
  - visual_communication
  - content
  - marketing
outputs:
  - visual_concept
max_risk: low
version: "1.0"
---

# Visual Content

Produces visual communication concepts: message hierarchy, formats, asset list,
and accessibility/brand consistency notes. This skill writes a specification;
it does not generate pixels, mock-ups or rendered media on its own.

## When to use

- "Design a visual concept for…", "What should the carousel / Reel / flyer look like?"
- Outlining formats (e.g. 1080x1080 carousel, 9:16 short, email header)
- Producing an asset list for a designer or production step
- Accessibility or brand-consistency review of a visual plan

## When NOT to use

- Writing the caption or body copy → `content-marketing`
- Publishing or scheduling to a platform → `social-community`
- Creating a finished image/video file (out of scope for this skill; not faked)

## Hard rules

- Output is a concept/spec, not a finished asset. The system never claims an
  external render happened when it did not.
- Formats must be explicit (dimensions, aspect ratio, file type).
- Message hierarchy (primary → secondary → supporting → CTA) is required.
- Accessibility notes (alt text, contrast, text size) are required for any
  external-facing concept.

## References

- Brand voice and channel guidance: `src/knowledge/brand-voice.json`
