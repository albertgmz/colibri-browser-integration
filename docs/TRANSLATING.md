# Contributing translations

English in `public/_locales/en/messages.json` is the default fallback. Add a reviewed GitHub contribution at `public/_locales/<browser-locale>/messages.json`, for example `fr` or `pt_BR`. Partial catalogs are allowed: omit untranslated entries, never save empty values. Preserve keys, named `$placeholders$`, and each placeholder's `content` such as `$1`. Keep product names, commands, and keyboard notation meaningful.

Run `node scripts/validate-locales.mjs`, `npm run typecheck`, `npm run lint`, and `npm test`. Validation rejects unknown keys, empty values, and changed placeholders. Keep `default_locale: "en"`; native browser i18n chooses the browser language and falls back to the parent/default catalog. The Colibri application's saved UI language does not override the browser locale and introduces no protocol change.

Include a coverage note in the pull request and have a fluent speaker review wording. Check popup, onboarding, context menus and notifications in the actual browser for wrapping and accessible labels. For the application's RESX translation instructions, see `Colibri/docs/TRANSLATING.md` in the sibling app repository. Browser conventions are documented in the [official i18n reference](https://developer.chrome.com/docs/extensions/reference/api/i18n).
