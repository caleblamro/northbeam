/* lib-primitives.jsx — shared helpers for the component library */

/* The live-preview's direct-edit harness reflects each component's authored
   props onto the host DOM node it renders. Custom (non-DOM) prop names then
   reach real <button>/<input> elements and trip React dev warnings. None of
   these are valid HTML attributes, so we strip them from host elements only.
   Components (function types) are untouched, so they still receive every prop.
   This is preview-only hygiene and a no-op in any exported build. */
(function patchCreateElement() {
  if (React.__dsPatched) return;
  React.__dsPatched = true;
  const NON_DOM = new Set([
    'iconRight',
    'endIcon',
    'leadIcon',
    'trailIcon',
    'leadAffix',
    'trailAffix',
    'onClickTrail',
    'loading',
    'active',
    'iconBtn',
    'iconBtnVariant',
    'leadicon',
    'trailicon',
    'iconright',
  ]);
  const orig = React.createElement;
  React.createElement = (type, props) => {
    if (typeof type === 'string' && props) {
      let copy = null;
      for (const k in props) {
        if (NON_DOM.has(k)) {
          if (!copy) copy = Object.assign({}, props);
          delete copy[k];
        }
      }
      if (copy) {
        arguments[1] = copy;
      }
    }
    return orig.apply(React, arguments);
  };
})();

const { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } = React;

/* close on outside click + Escape */
function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

function Spinner({ style }) {
  return <span className="spinner" style={style} aria-hidden="true" />;
}

/* Popover: portals a positioned panel to <body> so it never gets clipped by
   an overflow:hidden ancestor (frames, cards, scroll regions). Anchors below
   the trigger, flips up near the viewport bottom, matches trigger width on
   request, and closes on outside-click / Escape / scroll-away. */
function Popover({
  anchorRef,
  open,
  onClose,
  align = 'left',
  matchWidth,
  width,
  gap = 6,
  children,
}) {
  const popRef = useRef(null);
  const [st, setSt] = useState({
    position: 'fixed',
    top: -9999,
    left: -9999,
    visibility: 'hidden',
  });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current,
        pop = popRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const ph = pop ? pop.offsetHeight : 0;
      let top = r.bottom + gap;
      if (top + ph > window.innerHeight - 8 && r.top - gap - ph > 8) top = r.top - gap - ph;
      const s = { position: 'fixed', top, zIndex: 1000, visibility: 'visible' };
      if (matchWidth) {
        s.left = r.left;
        s.minWidth = r.width;
      } else if (align === 'right') {
        s.left = Math.max(8, r.right - (width || (pop ? pop.offsetWidth : 210)));
      } else {
        s.left = r.left;
      }
      if (width) s.width = width;
      setSt(s);
    };
    place();
    const h = () => place();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    return () => {
      window.removeEventListener('scroll', h, true);
      window.removeEventListener('resize', h);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const a = anchorRef.current,
        p = popRef.current;
      if (p && !p.contains(e.target) && a && !a.contains(e.target)) onClose && onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return ReactDOM.createPortal(
    <div
      ref={popRef}
      className={`menu ${align === 'right' ? 'menu--right' : ''}`}
      style={st}
      role="menu"
    >
      {children}
    </div>,
    document.body,
  );
}

/* deterministic avatar color from a string */
const AVATAR_COLORS = [
  '#635bff',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];
function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
}
function Avatar({ name, className, style }) {
  return (
    <span className={className} style={{ background: avatarColor(name), ...style }}>
      {initials(name)}
    </span>
  );
}

/* roving keyboard selection for menus/lists */
function useRovingIndex(length, open) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (open) setIdx(0);
  }, [open, length]);
  const onKey = useCallback(
    (e, onEnter) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onEnter?.(idx);
      }
    },
    [length, idx],
  );
  return [idx, setIdx, onKey];
}

Object.assign(window, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
  useDismiss,
  Spinner,
  Popover,
  Avatar,
  avatarColor,
  initials,
  useRovingIndex,
});
