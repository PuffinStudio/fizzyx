# UI Prototype

Generate three structurally different UI variants when the open question is visual. Prefer mounting variants inside the real page so existing navigation, density, and data remain visible. Use a throwaway route only when there is no natural host page.

Select variants with a reload-stable `?variant=` parameter and a development-only bottom switcher. Arrow buttons and left/right keyboard keys cycle through variants without intercepting input fields. Variants must differ in layout, information hierarchy, and primary affordance, not only color or copy.

Keep real mutations stubbed. After the user chooses, record why, remove losing variants and the switcher, then rewrite the winner to production quality. If the question concerns behavior or state, use [LOGIC.md](LOGIC.md).
