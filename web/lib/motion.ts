/**
 * Set before first paint, next to the theme script (`app/layout.tsx`).
 *
 * Only a class: whether anything starts hidden is decided in `globals.css`,
 * and reduced motion opts out there. Lives outside `components/appear.tsx`
 * because that file is a client module, and a server component importing a
 * string from one gets a client reference, not the string.
 */
export const motionScript = `document.documentElement.classList.add("motion-ok");`;
