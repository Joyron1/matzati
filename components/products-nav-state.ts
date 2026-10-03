// The header's "כל המוצרים" disclosure as a pure state machine (components/products-nav.tsx), so its
// rules are unit-tested: hover opens it and leaving closes it, but a click (the chevron, or the
// phone button) pins it open until a second click, Escape, a click outside, focus leaving it or a
// navigation. Hover never is the only way in: the button opens it from the keyboard too.

export interface NavMenuState {
  open: boolean;
  /** Opened (or kept open) by a click: leaving with the mouse does not close it. */
  pinned: boolean;
}

export type NavMenuEvent =
  "hover-enter" | "hover-leave" | "toggle" | "escape" | "outside" | "focus-out" | "navigate";

export const NAV_MENU_CLOSED: NavMenuState = { open: false, pinned: false };

export function navMenuReducer(state: NavMenuState, event: NavMenuEvent): NavMenuState {
  switch (event) {
    case "hover-enter":
      return state.open ? state : { open: true, pinned: false };
    case "hover-leave":
      return state.pinned ? state : NAV_MENU_CLOSED;
    case "toggle":
      // A click on a panel hover opened keeps it open (the pointer is still on the button);
      // a click on a pinned panel closes it.
      return state.open && state.pinned ? NAV_MENU_CLOSED : { open: true, pinned: true };
    case "escape":
    case "outside":
    case "focus-out":
    case "navigate":
      return state.open ? NAV_MENU_CLOSED : state;
  }
}

/** How long the mouse may be off the menu (crossing to the panel) before it closes. */
export const HOVER_CLOSE_DELAY_MS = 200;
