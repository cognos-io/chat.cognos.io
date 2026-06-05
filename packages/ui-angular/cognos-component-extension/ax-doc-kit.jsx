// Cognos — component-extension showcase. Documentation chrome primitives:
// sections, specimen frames, state labels, segmented control, and the toast host.
// Reuses the live Atlassian build (useA, AIcon, Lozenge, …) — never re-themes by hand.

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";

// ── Section: anchored block with eyebrow + title + intro ────────────────────
function DocSection({ id, eyebrow, title, intro, children }) {
  const a = useA();
  return (
    <section id={id} style={{ scrollMarginTop: 76, marginBottom: 64 }}>
      <div style={{ marginBottom: 24, maxWidth: 720 }}>
        {eyebrow && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: AFONT.sans, fontSize: 11,
            fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: a.link, marginBottom: 10 }}>
            <span style={{ width: 18, height: 2, borderRadius: 2, background: a.brand }} />{eyebrow}
          </div>
        )}
        <h2 style={{ margin: 0, fontFamily: AFONT.sans, fontSize: 26, fontWeight: 600, letterSpacing: '-0.012em', color: a.text }}>{title}</h2>
        {intro && <p style={{ margin: '10px 0 0', fontFamily: AFONT.sans, fontSize: 15, lineHeight: 1.6, color: a.subtle, textWrap: 'pretty' }}>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

// ── SubHead: small overline divider inside a section ────────────────────────
function SubHead({ children, top = 30 }) {
  const a = useA();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: `${top}px 0 14px` }}>
      <span style={{ fontFamily: AFONT.sans, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: a.subtlest, whiteSpace: 'nowrap' }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: a.border }} />
    </div>
  );
}

// ── Spec: a framed specimen — stage on app-bg + meta footer ─────────────────
function Spec({ title, desc, children, align = 'center', pad = '30px 26px', minH, stageBg }) {
  const a = useA();
  return (
    <div style={{ border: `1px solid ${a.border}`, borderRadius: ARAD.md, background: a.surface, overflow: 'hidden', boxShadow: a.shadowRaised }}>
      <div style={{ background: stageBg || a.appBg, padding: pad, minHeight: minH,
        display: 'flex', alignItems: 'center', justifyContent: align, gap: 26, flexWrap: 'wrap' }}>
        {children}
      </div>
      {(title || desc) && (
        <div style={{ borderTop: `1px solid ${a.border}`, padding: '11px 15px', background: a.surface }}>
          {title && <div style={{ fontFamily: AFONT.sans, fontSize: 13, fontWeight: 600, color: a.text }}>{title}</div>}
          {desc && <div style={{ fontFamily: AFONT.sans, fontSize: 12.5, color: a.subtle, marginTop: 2, lineHeight: 1.45, textWrap: 'pretty' }}>{desc}</div>}
        </div>
      )}
    </div>
  );
}

// ── SpecGrid: responsive grid of specimens ──────────────────────────────────
function SpecGrid({ children, min = 300, gap = 16, style }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap, ...style }}>{children}</div>;
}

// ── Variant: a single state shown above a monospace state label ─────────────
function Variant({ label, children, align = 'center' }) {
  const a = useA();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'stretch' ? 'stretch' : 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>{children}</div>
      <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: a.subtlest }}>{label}</span>
    </div>
  );
}

// ── Caption / Mono helpers ──────────────────────────────────────────────────
function SpecNote({ children, tone = 'info', icon = 'info' }) {
  return <div style={{ marginTop: 16 }}><SectionMessage tone={tone} icon={icon}>{children}</SectionMessage></div>;
}

// ── Segmented control (theme switchers) — in-system Atlassian look ───────────
function Seg({ value, options, onChange, size = 'md' }) {
  const a = useA();
  const h = size === 'sm' ? 28 : 32;
  return (
    <div style={{ display: 'inline-flex', padding: 2, gap: 2, background: a.neutralBg, borderRadius: ARAD.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{ height: h, padding: '0 11px', border: 0, cursor: 'pointer',
            borderRadius: ARAD.xs, fontFamily: AFONT.sans, fontSize: 13, fontWeight: on ? 600 : 500,
            color: on ? a.selectedText : a.subtle, background: on ? a.surface : 'transparent',
            boxShadow: on ? a.shadowRaised : 'none', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'background 0.1s, color 0.1s' }}>
            {o.icon && <AIcon name={o.icon} size={14} color={on ? a.selectedText : a.subtle} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Toast system ────────────────────────────────────────────────────────────
const ToastCtx = React.createContext(() => {});
const useToast = () => React.useContext(ToastCtx);

function ToastProvider({ children }) {
  const [items, setItems] = React.useState([]);
  const notify = React.useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, tone: 'success', icon: 'shield-check', ...t }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.duration || 3400);
  }, []);
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <ToastHost items={items} onDismiss={(id) => setItems((xs) => xs.filter((x) => x.id !== id))} />
    </ToastCtx.Provider>
  );
}

function ToastHost({ items, onDismiss }) {
  const a = useA();
  const toneFg = (t) => t === 'danger' ? a.danger : t === 'info' ? a.infoText : a.success;
  const toneBg = (t) => t === 'danger' ? a.lozRedBg || '#FFEDEB' : t === 'info' ? a.infoBg : a.successBg;
  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)', zIndex: 400,
      display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', pointerEvents: 'none' }}>
      {items.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto', minWidth: 300, maxWidth: 420, display: 'flex', alignItems: 'flex-start', gap: 12,
          background: a.surface, border: `1px solid ${a.border}`, borderRadius: ARAD.md, boxShadow: a.shadowOverlay,
          padding: '12px 12px 12px 14px', animation: 'aToastIn 0.18s cubic-bezier(0.16,1,0.3,1)' }}>
          <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 9999, background: toneBg(t.tone),
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AIcon name={t.icon} size={15} color={toneFg(t.tone)} />
          </span>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
            <div style={{ fontFamily: AFONT.sans, fontSize: 13.5, fontWeight: 600, color: a.text }}>{t.title}</div>
            {t.msg && <div style={{ fontFamily: AFONT.sans, fontSize: 12.5, color: a.subtle, marginTop: 2, lineHeight: 1.45 }}>{t.msg}</div>}
            {t.action && (
              <button onClick={() => { t.action.onClick && t.action.onClick(); onDismiss(t.id); }}
                style={{ marginTop: 7, border: 0, background: 'transparent', cursor: 'pointer', padding: 0,
                  fontFamily: AFONT.sans, fontSize: 12.5, fontWeight: 600, color: a.link }}>{t.action.label}</button>
            )}
          </div>
          <button onClick={() => onDismiss(t.id)} title="Dismiss" style={{ width: 24, height: 24, flexShrink: 0, border: 0, cursor: 'pointer',
            background: 'transparent', borderRadius: ARAD.xs, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <AIcon name="x" size={14} color={a.subtlest} />
          </button>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { MONO, DocSection, SubHead, Spec, SpecGrid, Variant, SpecNote, Seg, ToastCtx, useToast, ToastProvider, ToastHost });
