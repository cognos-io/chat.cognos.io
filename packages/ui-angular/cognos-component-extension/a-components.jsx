// Cognos — Atlassian Design System build. Atlassian blue, lozenges, breadcrumbs,
// system-font UI, small 3px radii, green toggles, light-blue selected nav.

// Accent families — Atlassian ships blue, but the token system swaps cleanly.
const A_ACCENTS = {
  blue: {
    light: { brand: '#0C66E4', brandHover: '#0055CC', brandPressed: '#09326C', onBrand: '#FFFFFF', link: '#0C66E4', selectedBg: '#E9F2FF', selectedText: '#0C66E4', selectedBorder: '#0C66E4' },
    dark:  { brand: '#579DFF', brandHover: '#85B8FF', brandPressed: '#CCE0FF', onBrand: '#1D2125', link: '#579DFF', selectedBg: '#1C2B41', selectedText: '#85B8FF', selectedBorder: '#579DFF' },
  },
  emerald: {
    light: { brand: '#1F845A', brandHover: '#216E4E', brandPressed: '#164B35', onBrand: '#FFFFFF', link: '#216E4E', selectedBg: '#DCFFF1', selectedText: '#216E4E', selectedBorder: '#1F845A' },
    dark:  { brand: '#4BCE97', brandHover: '#7EE2B8', brandPressed: '#BAF3D6', onBrand: '#1D2125', link: '#4BCE97', selectedBg: '#143A2B', selectedText: '#7EE2B8', selectedBorder: '#4BCE97' },
  },
};

// Selectable UI typefaces (Atkinson Hyperlegible is loaded in the HTML head).
const SYSTEM_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";
const FONT_STACKS = {
  system: SYSTEM_STACK,
  atkinson: "'Atkinson Hyperlegible'," + SYSTEM_STACK,
  inter: "'Inter'," + SYSTEM_STACK,
  noto: "'Noto Sans'," + SYSTEM_STACK,
};

function buildAtlas(mode, accent) {
  const acc = (A_ACCENTS[accent] || A_ACCENTS.blue)[mode === 'dark' ? 'dark' : 'light'];
  if (mode === 'dark') {
    return {
      mode, ...acc,
      appBg: '#161A1D', navBg: '#1D2125', surface: '#1D2125', raised: '#22272B',
      sunken: '#161A1D', hover: '#22272B', pressed: '#282E33',
      text: '#C7D1DB', subtle: '#9FADBC', subtlest: '#8C9BAB', disabled: '#738496',
      border: '#38414A', borderBold: '#454F59',
      neutralBg: '#2C333A', neutralHover: '#38414A', neutralText: '#9FADBC',
      inputBg: '#22272B', inputBgFocus: '#1D2125',
      success: '#4BCE97', successBg: '#164B35', successText: '#7EE2B8',
      danger: '#F87168', dangerText: '#FF9C8F',
      infoBg: '#1C2B41', infoText: '#85B8FF',
      lozNeutralBg: '#2C333A', lozNeutralText: '#9FADBC',
      lozBlueBg: '#1C2B41', lozBlueText: '#85B8FF',
      lozGreenBg: '#164B35', lozGreenText: '#7EE2B8',
      lozPurpleBg: '#2B273F', lozPurpleText: '#B8ACF6',
      shadowRaised: '0 1px 1px rgba(3,4,4,0.5), 0 0 1px rgba(3,4,4,0.6)',
      shadowOverlay: '0 8px 12px rgba(3,4,4,0.56), 0 0 1px rgba(3,4,4,0.6)',
    };
  }
  return {
    mode, ...acc,
    appBg: '#F7F8F9', navBg: '#FFFFFF', surface: '#FFFFFF', raised: '#FFFFFF',
    sunken: '#F7F8F9', hover: '#F1F2F4', pressed: '#DCDFE4',
    text: '#172B4D', subtle: '#44546F', subtlest: '#626F86', disabled: '#8590A2',
    border: '#DFE1E6', borderBold: '#B3B9C4',
    neutralBg: '#F1F2F4', neutralHover: '#DCDFE4', neutralText: '#44546F',
    inputBg: '#F7F8F9', inputBgFocus: '#FFFFFF',
    success: '#22A06B', successBg: '#DCFFF1', successText: '#216E4E',
    danger: '#C9372C', dangerText: '#AE2A19',
    infoBg: '#E9F2FF', infoText: '#0C66E4',
    lozNeutralBg: '#DCDFE4', lozNeutralText: '#44546F',
    lozBlueBg: '#E9F2FF', lozBlueText: '#0055CC',
    lozGreenBg: '#DCFFF1', lozGreenText: '#216E4E',
    lozPurpleBg: '#F3F0FF', lozPurpleText: '#5E4DB2',
    shadowRaised: '0 1px 1px rgba(9,30,66,0.25), 0 0 1px rgba(9,30,66,0.31)',
    shadowOverlay: '0 8px 12px rgba(9,30,66,0.15), 0 0 1px rgba(9,30,66,0.31)',
  };
}

const ACtx = React.createContext(buildAtlas('light'));
const useA = () => React.useContext(ACtx);

// Font family resolves from a CSS variable the app sets per the font tweak,
// so changing the typeface re-flows every component at once.
const AFONT = {
  sans: "var(--cog-font, " + SYSTEM_STACK + ")",
};
const ARAD = { xs: 3, sm: 4, md: 8 };

function aHover() {
  const [h, setH] = React.useState(false);
  return [h, { onMouseEnter: () => setH(true), onMouseLeave: () => setH(false) }];
}

// ── Inline-SVG icon (Lucide, React-owned) ───────────────────────────────────
function __aPascal(n) { return String(n).split(/[-_]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(''); }
function __aCamel(k) { return k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function __aNode(name) {
  const L = window.lucide; if (!L) return null;
  const key = __aPascal(name);
  let node = (L.icons && L.icons[key]) || L[key] || null;
  if (node && !Array.isArray(node) && node.node) node = node.node;
  return Array.isArray(node) ? node : null;
}
function AIcon({ name, size = 16, color, strokeWidth = 2, style }) {
  const node = __aNode(name);
  const children = node ? node.map(([tag, attrs], i) => {
    const props = { key: i }; for (const k in attrs) props[__aCamel(k)] = attrs[k];
    return React.createElement(tag, props);
  }) : null;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color || 'currentColor'} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'middle', ...style }}>{children}</svg>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────
function AButton({ children, appearance = 'default', icon, iconRight, onClick, disabled, style }) {
  const a = useA();
  const [h, hb] = aHover();
  const [p, setP] = React.useState(false);
  const V = {
    default: { bg: p ? a.pressed : h ? a.neutralHover : a.neutralBg, fg: a.neutralText, border: 'transparent' },
    primary: { bg: p ? a.brandPressed : h ? a.brandHover : a.brand, fg: a.onBrand, border: 'transparent' },
    subtle:  { bg: p ? a.pressed : h ? a.hover : 'transparent', fg: a.subtle, border: 'transparent' },
    link:    { bg: 'transparent', fg: a.link, border: 'transparent' },
    danger:  { bg: p ? '#A8200F' : h ? '#AE2A19' : a.danger, fg: '#FFFFFF', border: 'transparent' },
  }[appearance];
  return (
    <button {...hb} onClick={onClick} disabled={disabled} onMouseDown={() => setP(true)} onMouseUp={() => setP(false)}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 32,
        padding: appearance === 'link' ? '0 2px' : '0 12px', borderRadius: ARAD.xs, cursor: disabled ? 'not-allowed' : 'pointer',
        background: V.bg, color: V.fg, border: `1px solid ${V.border}`, fontFamily: AFONT.sans, fontSize: 14, fontWeight: 500,
        whiteSpace: 'nowrap', opacity: disabled ? 0.5 : 1, transition: 'background 0.1s', ...style }}>
      {icon && <AIcon name={icon} size={16} color={V.fg} />}
      {children}
      {iconRight && <AIcon name={iconRight} size={14} color={V.fg} />}
    </button>
  );
}

function AIconBtn({ name, size = 16, onClick, title, selected, style }) {
  const a = useA();
  const [h, hb] = aHover();
  return (
    <button {...hb} onClick={onClick} title={title} style={{ width: 32, height: 32, borderRadius: ARAD.xs,
      border: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: selected ? a.selectedBg : h ? a.hover : 'transparent', transition: 'background 0.1s', ...style }}>
      <AIcon name={name} size={size} color={selected ? a.selectedText : a.subtle} />
    </button>
  );
}

// ── Lozenge ──────────────────────────────────────────────────────────────────
function Lozenge({ children, tone = 'neutral', style }) {
  const a = useA();
  const T = {
    neutral: [a.lozNeutralBg, a.lozNeutralText],
    blue: [a.lozBlueBg, a.lozBlueText],
    green: [a.lozGreenBg, a.lozGreenText],
    purple: [a.lozPurpleBg, a.lozPurpleText],
  }[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', background: T[0], color: T[1],
      fontFamily: AFONT.sans, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase',
      padding: '1px 5px', borderRadius: ARAD.xs, lineHeight: 1.4, whiteSpace: 'nowrap', ...style }}>{children}</span>
  );
}

// ── Toggle (green when on — Atlassian signature) ────────────────────────────
function AToggle({ on, onChange }) {
  const a = useA();
  return (
    <button role="switch" aria-checked={on} onClick={onChange} style={{ width: 28, height: 16, borderRadius: 9999,
      position: 'relative', cursor: 'pointer', border: 0, padding: 0, flexShrink: 0,
      background: on ? a.success : a.borderBold, transition: 'background 0.15s' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: 9999,
        background: '#FFFFFF', transition: 'left 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {on && <AIcon name="check" size={9} color={a.success} strokeWidth={3} />}
      </span>
    </button>
  );
}

// ── Text field (classic AtlasKit: 2px border, focus brand) ──────────────────
function AField({ value, onChange, onKeyDown, placeholder, icon, inputRef, style }) {
  const a = useA();
  const [focus, setFocus] = React.useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 8px',
      background: focus ? a.inputBgFocus : a.inputBg, borderRadius: ARAD.xs,
      border: `2px solid ${focus ? a.brand : a.border}`, transition: 'border-color 0.1s, background 0.1s', ...style }}>
      {icon && <AIcon name={icon} size={15} color={a.subtlest} />}
      <input ref={inputRef} value={value} onChange={onChange} onKeyDown={onKeyDown}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent',
          fontFamily: AFONT.sans, fontSize: 14, color: a.text }} />
    </div>
  );
}

// ── Dropdown menu ────────────────────────────────────────────────────────────
function AMenu({ children, onClose, width = 320, style }) {
  const a = useA();
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
      <div style={{ position: 'absolute', zIndex: 91, width, background: a.surface, borderRadius: ARAD.sm,
        boxShadow: a.shadowOverlay, border: a.mode === 'dark' ? `1px solid ${a.border}` : 'none',
        overflow: 'hidden', padding: '4px 0', animation: 'aProp 0.1s ease-out', ...style }}>{children}</div>
    </>
  );
}
function AMenuItem({ icon, title, sub, trailing, selected, onClick }) {
  const a = useA();
  const [h, hb] = aHover();
  return (
    <button {...hb} onClick={onClick} style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer',
      background: h ? a.hover : selected ? a.selectedBg : 'transparent', padding: sub ? '8px 12px' : '0 12px',
      minHeight: 36, display: 'flex', alignItems: sub ? 'flex-start' : 'center', gap: 10 }}>
      {icon && <AIcon name={icon} size={16} color={selected ? a.selectedText : a.subtle} style={{ marginTop: sub ? 2 : 0 }} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: AFONT.sans, fontSize: 14, fontWeight: selected ? 600 : 400,
          color: selected ? a.selectedText : a.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        {sub && <span style={{ display: 'block', fontFamily: AFONT.sans, fontSize: 12, color: a.subtlest, marginTop: 2, lineHeight: 1.4 }}>{sub}</span>}
      </span>
      {trailing && <AIcon name={trailing} size={15} color={a.selectedText} />}
    </button>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
function AModal({ children, onClose, width = 560, title }) {
  const a = useA();
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(9,30,66,0.54)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 24px', overflow: 'auto',
      animation: 'aFade 0.1s ease-out' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: '100%', background: a.surface,
        borderRadius: ARAD.md, boxShadow: a.shadowOverlay, animation: 'aProp 0.15s ease-out' }}>
        {title && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 24px 0' }}>
            <h2 style={{ flex: 1, margin: 0, fontFamily: AFONT.sans, fontSize: 20, fontWeight: 600, color: a.text, letterSpacing: '-0.003em' }}>{title}</h2>
            <AIconBtn name="x" size={16} title="Close" onClick={onClose} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ── Section message (Atlassian inline message) ──────────────────────────────
function SectionMessage({ children, title, icon = 'info', tone = 'info' }) {
  const a = useA();
  const bg = tone === 'info' ? a.infoBg : a.successBg;
  const fg = tone === 'info' ? a.infoText : a.successText;
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 14px', background: bg, borderRadius: ARAD.sm }}>
      <AIcon name={icon} size={18} color={fg} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ fontFamily: AFONT.sans, fontSize: 13, fontWeight: 700, color: a.text, marginBottom: 4 }}>{title}</div>}
        <div style={{ fontFamily: AFONT.sans, fontSize: 13.5, color: a.text, lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Breadcrumbs ──────────────────────────────────────────────────────────────
function Breadcrumbs({ items }) {
  const a = useA();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: a.subtlest, fontSize: 13 }}>/</span>}
          <button onClick={it.onClick} style={{ border: 0, background: 'transparent', cursor: it.onClick ? 'pointer' : 'default',
            fontFamily: AFONT.sans, fontSize: 12, color: a.subtle, padding: '2px 4px', borderRadius: ARAD.xs,
            textDecoration: it.onClick ? 'none' : 'none' }}
            onMouseEnter={(e) => { if (it.onClick) e.currentTarget.style.textDecoration = 'underline'; }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}>{it.label}</button>
        </React.Fragment>
      ))}
    </div>
  );
}

Object.assign(window, {
  buildAtlas, A_ACCENTS, FONT_STACKS, ACtx, useA, AFONT, ARAD, aHover,
  AIcon, AButton, AIconBtn, Lozenge, AToggle, AField, AMenu, AMenuItem, AModal, SectionMessage, Breadcrumbs,
});
