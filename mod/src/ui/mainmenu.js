import { el } from "../util.js";

const BUTTON_CLASS = "polyranked-menu-button";

/** Inline trophy icon (white, matches the game's menu icons). */
export const TROPHY_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#fff" d="M18 8h28v6h8v8c0 7-5 12-11 13-2 4-6 7-9 8v7h8v6H22v-6h8v-7c-3-1-7-4-9-8C15 34 10 29 10 22v-8h8V8zm0 12h-3v2c0 3 2 6 5 7-1-3-2-6-2-9zm28 0c0 3-1 6-2 9 3-1 5-4 5-7v-2h-3z"/></svg>`,
  );

/**
 * Add a "Ranked" button next to the main menu's Multiplayer button whenever the main menu
 * is (re)built. Returns a dispose function.
 */
export function installMainMenuButton(onClick) {
  const ui = document.getElementById("ui");
  if (!ui) return () => {};

  const tryInject = () => {
    const img = ui.querySelector('button.button-image img[src="images/multiplayer.svg"]');
    const mpButton = img?.closest("button");
    if (!mpButton || !mpButton.parentElement) return;
    if (mpButton.parentElement.querySelector("." + BUTTON_CLASS)) return;
    const button = el("button", {
      className: mpButton.className + " " + BUTTON_CLASS,
      on: {
        click: (ev) => {
          ev.preventDefault();
          onClick();
        },
      },
    });
    button.appendChild(el("img", { attrs: { src: TROPHY_SVG, alt: "" } }));
    button.appendChild(el("p", { text: "Ranked" }));
    mpButton.insertAdjacentElement("afterend", button);
  };

  const observer = new MutationObserver(() => tryInject());
  observer.observe(ui, { childList: true, subtree: true });
  tryInject();
  return () => observer.disconnect();
}
