"use client";

/**
 * Dragging a player around the tactics board (Adam, 2026-08-25: "Should be
 * able to drag and drop players on to the pitch and also substitutes").
 *
 * Pointer Events, not a library: one API covers mouse, touch and pen, so the
 * coach on the touchline and the coach at a laptop run the same code, and the
 * app takes on no new dependency for one screen. The pieces that make that
 * work on a phone:
 *
 *   * `touch-action: none` on the DRAG HANDLE only — the shirt itself. The rest
 *     of a squad row still scrolls the page, so the list a coach is dragging
 *     out of never becomes a scroll trap.
 *   * `setPointerCapture`, so the moves and the release keep coming to the
 *     token even when the finger leaves it. No window listeners to leak.
 *   * A movement threshold. Under 8px nothing starts, the browser fires its
 *     click, and tap-to-pick — the accessible path, and the only one a
 *     keyboard or screen reader has — behaves exactly as it did before drag
 *     existed. Past 8px the gesture becomes a drag and the click that follows
 *     it is swallowed by `consumeClick`.
 *   * The carried token moves by writing `transform` straight onto the ghost
 *     element. React re-renders only when the slot under the finger CHANGES,
 *     which is a handful of renders per drag rather than one per frame.
 *   * Edge auto-scroll, because the pitch is usually off the top of the screen
 *     when the coach starts dragging out of the squad list.
 *
 * Drop targets register themselves by key: a formation slot key ("GK"), a
 * bench key ("SUB1"), or `UNPLACED_ZONE` for the list, which means "take this
 * player off the board". A drop outside every zone is a cancel, and so is
 * Escape.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** The drop zone that means "off the board". */
export const UNPLACED_ZONE = "__unplaced";

/** Below this many pixels of movement the gesture is a tap, not a drag. */
const DRAG_THRESHOLD = 8;

export type CarriedToken = {
  personId: string;
  /** The slot the token was picked up from, or null when it came off the list. */
  from: string | null;
  /** The zone key under the pointer right now. */
  over: string | null;
};

export type DragHandleProps = {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  style: React.CSSProperties;
};

export type LineupDrag = {
  /** What is being carried, or null when nothing is. */
  carrying: CarriedToken | null;
  /** Spread onto whatever the coach grabs. */
  handleProps: (personId: string, from: string | null) => DragHandleProps;
  /** `ref` for a drop zone, keyed by slot key or `UNPLACED_ZONE`. */
  zoneRef: (key: string) => (element: HTMLElement | null) => void;
  /** `ref` for the token that follows the pointer. */
  ghostRef: (element: HTMLElement | null) => void;
  /** True exactly once after a drag, so the click it produced can be ignored. */
  consumeClick: () => boolean;
};

const NO_DRAG: DragHandleProps = {
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
  style: {},
};

export function useLineupDrag({
  enabled,
  onDrop,
}: {
  enabled: boolean;
  /** `to` is a slot key, `UNPLACED_ZONE`, or null for a drop into nowhere. */
  onDrop: (personId: string, from: string | null, to: string | null) => void;
}): LineupDrag {
  const [carrying, setCarrying] = useState<CarriedToken | null>(null);

  const zones = useRef(new Map<string, HTMLElement>());
  const zoneRefs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const ghost = useRef<HTMLElement | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    personId: string;
    from: string | null;
    active: boolean;
    over: string | null;
  } | null>(null);
  const clicked = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const moveGhost = useCallback(() => {
    const element = ghost.current;
    if (element) {
      element.style.transform = `translate3d(${point.current.x}px, ${point.current.y}px, 0) translate(-50%, -50%)`;
    }
  }, []);

  const ghostRef = useCallback(
    (element: HTMLElement | null) => {
      ghost.current = element;
      // Place it before the browser paints, or it flashes at the top left.
      moveGhost();
    },
    [moveGhost],
  );

  const zoneRef = useCallback((key: string) => {
    const existing = zoneRefs.current.get(key);
    if (existing) return existing;
    const ref = (element: HTMLElement | null) => {
      if (element) zones.current.set(key, element);
      else zones.current.delete(key);
    };
    zoneRefs.current.set(key, ref);
    return ref;
  }, []);

  const zoneAt = useCallback((x: number, y: number): string | null => {
    for (const [key, element] of zones.current) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return key;
    }
    return null;
  }, []);

  const end = useCallback((cancelled: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    ghost.current = null;
    setCarrying(null);
    if (!current?.active) return;
    // The browser will follow the release with a click on the token; the tap
    // handlers must not treat a finished drag as a tap.
    clicked.current = true;
    if (!cancelled) dropRef.current(current.personId, current.from, current.over);
  }, []);

  /**
   * The board is taller than a phone: a full pitch plus a bench plus the squad
   * list is well over a screen, so the position a coach is dragging towards is
   * usually off the top of it. Carrying a shirt into the top or bottom 80px of
   * the viewport scrolls the page under it, faster the closer to the edge —
   * without this, dragging out of the list could only ever reach whatever
   * happened to be on screen already. The zone under the finger is re-read
   * after each scroll, because the finger has not moved but the pitch has.
   */
  const dragging = carrying !== null;
  useEffect(() => {
    if (!dragging) return;
    const EDGE = 80;
    const MAX_STEP = 14;
    let frame = 0;
    const step = () => {
      frame = requestAnimationFrame(step);
      const current = gesture.current;
      if (!current?.active) return;

      const { x, y } = point.current;
      const height = window.innerHeight;
      let by = 0;
      if (y < EDGE) by = -MAX_STEP * Math.min(1, (EDGE - y) / EDGE);
      else if (y > height - EDGE) by = MAX_STEP * Math.min(1, (y - (height - EDGE)) / EDGE);
      if (by === 0) return;

      const before = window.scrollY;
      window.scrollBy(0, by);
      if (window.scrollY === before) return;

      const over = zoneAt(x, y);
      if (over !== current.over) {
        current.over = over;
        setCarrying({ personId: current.personId, from: current.from, over });
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [dragging, zoneAt]);

  // Escape gets the coach out of a drag they did not mean to start.
  useEffect(() => {
    if (!carrying) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") end(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [carrying, end]);

  const handleProps = useCallback(
    (personId: string, from: string | null): DragHandleProps => {
      if (!enabled) return NO_DRAG;
      return {
        style: { touchAction: "none" },
        onPointerDown: (event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          if (gesture.current) return;
          clicked.current = false;
          gesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            personId,
            from,
            active: false,
            over: null,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event) => {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          point.current = { x: event.clientX, y: event.clientY };

          if (!current.active) {
            const far =
              Math.abs(event.clientX - current.startX) > DRAG_THRESHOLD ||
              Math.abs(event.clientY - current.startY) > DRAG_THRESHOLD;
            if (!far) return;
            current.active = true;
            current.over = zoneAt(event.clientX, event.clientY);
            setCarrying({ personId, from, over: current.over });
            return;
          }

          moveGhost();
          const over = zoneAt(event.clientX, event.clientY);
          if (over !== current.over) {
            current.over = over;
            setCarrying({ personId, from, over });
          }
        },
        onPointerUp: (event) => {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          if (current.active) current.over = zoneAt(event.clientX, event.clientY);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          end(false);
        },
        onPointerCancel: (event) => {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          end(true);
        },
      };
    },
    [enabled, end, moveGhost, zoneAt],
  );

  const consumeClick = useCallback(() => {
    if (!clicked.current) return false;
    clicked.current = false;
    return true;
  }, []);

  return { carrying, handleProps, zoneRef, ghostRef, consumeClick };
}
