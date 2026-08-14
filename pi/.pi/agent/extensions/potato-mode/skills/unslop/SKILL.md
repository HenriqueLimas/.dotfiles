---
name: unslop
description: Remove AI tells, filler, vague claims, and inflated structure from prose while preserving meaning and adding a specific human voice. Use for final replies, docs, plans, PR text, and generated explanations.
disable-model-invocation: true
---

# Unslop

Rewrite once, cleanly. Do not polish vague prose. Replace it with facts.

## Rules

- Cut puffery, promotional language, generic conclusions, and chatbot phrases.
- Replace vague attribution with a named source or remove it.
- Use plain words. Prefer "use", "help", and "start" over inflated synonyms.
- Name concrete files, symbols, commands, measurements, and people.
- Keep one thought per sentence. Vary sentence length without making sentences dense.
- Prefer active voice when the actor matters.
- Remove forced groups of three, synonym cycling, false ranges, and repetitive headings.
- Avoid decorative emoji, title-case headings, excessive bold text, and inline labels that repeat their sentence.
- Avoid em dashes. Use a period when the thought deserves separation.
- Use a colon before a real list or example, not as a dramatic connector.
- State opinions when judgment is part of the job. Do not hide behind neutral pros-and-cons lists.
- Preserve technical precision and the writer's intended tone.

## Audit

Ask what makes the text look generated. Remove any sentence that could appear unchanged in another project's report. Verify links, counts, paths, and claims before keeping them.
