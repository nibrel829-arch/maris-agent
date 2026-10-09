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
  - image.generate
  - generate_image_asset
  - prepare_video_draft
  - export_video_file
  - save_library_asset
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
and accessibility/brand consistency notes. A specification is always saved
first. Pixel generation uses `image.generate`, which calls the Nibrexo image
engine. OpenAI, Cloudflare, Pollinations and Arena are not called. A missing
worker, missing weights, or insufficient RAM blocks the step; no placeholder
image is saved.

## When to use

- "Design a visual concept for…", "What should the carousel / Reel / flyer look like?"
- Outlining formats (e.g. 1080x1080 carousel, 9:16 short, email header)
- Producing an asset list for a designer or production step
- Accessibility or brand-consistency review of a visual plan

## When NOT to use

- Writing the caption or body copy → `content-marketing`
- Publishing or scheduling to a platform → `social-community`
- Claiming an image or video file exists when the provider did not return one

## Hard rules

- Output is a concept/spec, not a finished asset. The system never claims an
  external render happened when it did not.
- Formats must be explicit (dimensions, aspect ratio, file type).
- Message hierarchy (primary → secondary → supporting → CTA) is required.
- Accessibility notes (alt text, contrast, text size) are required for any
  external-facing concept.

## References

- Brand voice and channel guidance: `src/knowledge/brand-voice.json`
