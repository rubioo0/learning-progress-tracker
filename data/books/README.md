# Study Book Packs

Drop a `<id>.json` file in this folder to make a book/syllabus importable from the app's
**Import Study Book** button (or `POST /api/books/<id>/import`). No code changes needed —
`GET /api/books` lists whatever `.json` files exist here.

## File shape

```json
{
  "meta": {
    "title": "Book or syllabus title shown in the UI",
    "author": "Author(s) — optional",
    "edition": "Edition/version — optional"
  },
  "topics": [
    {
      "title": "Unique topic title (used to detect duplicates on re-import)",
      "category": "Books",
      "module": "Book Title — Chapter N: Chapter Name",
      "description": "1-3 sentence neutral summary of what this section covers.",
      "notes": "Citation/pointer back to the book, e.g. which chapter/page to read first.",
      "status": "not-started",
      "order_index": 1,
      "questions": [
        { "text": "A self-check prompt for this section", "answered": false }
      ]
    }
  ]
}
```

- `category` should be `"Books"` so it groups under the app's dynamic "Books" filter.
- `module` becomes the section header topics are grouped under in the UI — group all
  sections of one book/chapter under a consistent module string.
- `title` must be unique across the whole `topics` table (not just this file) — the
  import endpoint uses it to skip topics that already exist, so re-importing is safe.
- `questions` are the same self-check checklist used elsewhere in the app (toggle
  answered/unanswered from the topic modal) — not scored quiz questions.
- Once imported, clicking the ✨ AI button on a topic with `category: "Books"` uses an
  exam-prep-style prompt (definitions, common exam traps, practice MCQs) instead of the
  app's default hands-on-engineering prompt — see `services/gemini-ai.js` →
  `buildBookStudyPrompt()`.

## Content guidance

Only write section titles/descriptions/self-check prompts from **publicly available**
syllabus outlines or your own understanding — never paste copyrighted book text into
these files. The AI-generated content (via the ✨ button) is what actually produces the
long-form study material at read time; these files just seed the topic structure and
study prompts, similar to a table of contents plus a self-check checklist.

## Example

`istqb-ctfl-v4.json` — ISTQB Certified Tester Foundation Level, Syllabus v4.0. One topic
per official syllabus section (22 total across 6 chapters), citing the Springer self-study
guide (Stapp/Roman/Pilaeten) as the companion book to read alongside it.
