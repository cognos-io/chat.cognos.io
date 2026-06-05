// Cognos extension — showcase shell: theme state, top bar, side nav, overview,
// and composition of every section. Builds on the Atlassian build; never alters it.

const AX_NAV = [
  { id: 'overview', icon: 'layers', label: 'Overview' },
  { id: 'files', icon: 'paperclip', label: 'Files & documents' },
  { id: 'images', icon: 'image', label: 'Images' },
  { id: 'vault', icon: 'folder-lock', label: 'The Vault' },
  { id: 'conversation', icon: 'message-square', label: 'Conversation & system' },
];

const AX_FONTS = [
  { value: 'system', label: 'System default' },
  { value: 'atkinson', label: 'Atkinson Hyperlegible' },
  { value: 'inter', label: 'Inter' },
  { value: 'noto', label: 'Noto Sans' },
];

function AXTopBar({ t, setT }) {
  const a = useA();
  const [fontMenu, setFontMenu] = React.useState(false);
  const fontLabel = (AX_FONTS.find((f) => f.value === t.font) || AX_FONTS[0]).label;
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 60, height: 58, flexShrink: 0, background: a.surface,
      borderBottom: `1px solid ${a.border}`, display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px' }}>
      <span style={{ width: 28, height: 28, borderRadius: ARAD.xs, background: a.brand, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AIcon name="lock" size={15} color={a.onBrand} />
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
        <span style={{ fontFamily: AFONT.sans, fontSize: 16, fontWeight: 600, color: a.text }}>Cognos</span>
        <span style={{ fontFamily: AFONT.sans, fontSize: 13, color: a.subtlest, whiteSpace: 'nowrap' }}>Component Extension</span>
        <Lozenge tone="neutral">v1</Lozenge>
      </div>
      <span style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative' }}>
          <AButton appearance="subtle" icon="type" iconRight="chevron-down" onClick={() => setFontMenu((m) => !m)} style={{ fontWeight: 400 }}>{fontLabel}</AButton>
          {fontMenu && (
            <AMenu onClose={() => setFontMenu(false)} width={220} style={{ top: 'calc(100% + 6px)', right: 0 }}>
              {AX_FONTS.map((f) => <AMenuItem key={f.value} title={f.label} selected={f.value === t.font} trailing={f.value === t.font ? 'check' : undefined} onClick={() => { setT('font', f.value); setFontMenu(false); }} />)}
            </AMenu>
          )}
        </div>
        <Seg value={t.accent} onChange={(v) => setT('accent', v)} options={[{ value: 'emerald', label: 'Emerald' }, { value: 'blue', label: 'Blue' }]} />
        <Seg value={t.mode} onChange={(v) => setT('mode', v)} options={[{ value: 'light', icon: 'sun', label: 'Light' }, { value: 'dark', icon: 'moon', label: 'Dark' }]} />
      </div>
    </header>
  );
}

function AXSideNav({ active }) {
  const a = useA();
  return (
    <nav style={{ width: 232, flexShrink: 0, position: 'sticky', top: 58, alignSelf: 'flex-start', height: 'calc(100vh - 58px)',
      overflow: 'auto', borderRight: `1px solid ${a.border}`, background: a.navBg, padding: '20px 12px' }}>
      <div style={{ fontFamily: AFONT.sans, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: a.subtlest, padding: '0 10px 8px' }}>Sections</div>
      {AX_NAV.map((n) => {
        const on = n.id === active;
        return (
          <a key={n.id} href={'#' + n.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, height: 38, padding: '0 10px',
            borderRadius: ARAD.sm, marginBottom: 2, textDecoration: 'none', background: on ? a.selectedBg : 'transparent', transition: 'background 0.1s' }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = a.hover; }} onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
            {on && <span style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 2, borderRadius: 2, background: a.selectedBorder }} />}
            <AIcon name={n.icon} size={16} color={on ? a.selectedText : a.subtle} />
            <span style={{ fontFamily: AFONT.sans, fontSize: 13.5, fontWeight: on ? 600 : 400, color: on ? a.selectedText : a.text }}>{n.label}</span>
          </a>
        );
      })}
      <div style={{ marginTop: 18, padding: '11px 12px', borderRadius: ARAD.sm, background: a.successBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: AFONT.sans, fontSize: 12, fontWeight: 600, color: a.successText }}>
          <AIcon name="shield-check" size={14} color={a.successText} /> Privacy-first
        </div>
        <div style={{ fontFamily: AFONT.sans, fontSize: 11.5, color: a.successText, marginTop: 4, lineHeight: 1.45, opacity: 0.95 }}>
          Every component states where data lives and resolves to an encrypted lock.
        </div>
      </div>
    </nav>
  );
}

function OverviewSection() {
  const a = useA();
  const cards = [
    { id: 'files', icon: 'paperclip', title: 'Files & documents', n: '6 components', d: 'Type badges, attachment cards, dropzone, upload progress, voice note.' },
    { id: 'images', icon: 'image', title: 'Images', n: '5 components', d: 'Upload grid, lightbox, model-generated images, composer staging.' },
    { id: 'vault', icon: 'folder-lock', title: 'The Vault', n: '7 components', d: 'File cards, storage meter, page, empty state, picker, crypto-shred.' },
    { id: 'conversation', icon: 'message-square', title: 'Conversation & system', n: '5 components', d: 'Source cards, reference chip, code block, toasts.' },
  ];
  return (
    <DocSection id="overview" eyebrow="Cognos · Extension v1" title="Components for files, images & the Vault"
      intro="An addition to the Cognos system that gives privacy-conscious people the parts an AI chat needs to handle their own material — uploads, generated images, and a personal encrypted Vault they can reference across chats. It reuses the existing primitives, tokens and tone; nothing here re-themes what you already have.">
      <div style={{ marginBottom: 22 }}>
        <SectionMessage tone="success" icon="shield-check" title="Built on the Atlassian / Emerald build">
          Lozenges, breadcrumbs, 2px-border fields, green toggles and the “encrypted on this device” language all carry over unchanged. Toggle mode, accent and typeface in the header — every new component re-themes with the system.
        </SectionMessage>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
        {cards.map((c) => <OverviewCard key={c.id} {...c} />)}
      </div>
    </DocSection>
  );
}
function OverviewCard({ id, icon, title, n, d }) {
  const a = useA();
  const [h, hb] = aHover();
  return (
    <a href={'#' + id} {...hb} style={{ display: 'block', textDecoration: 'none', border: `1px solid ${h ? a.borderBold : a.border}`, borderRadius: ARAD.md,
      background: a.surface, padding: 16, boxShadow: h ? a.shadowRaised : 'none', transition: 'box-shadow 0.1s, border-color 0.1s' }}>
      <span style={{ width: 36, height: 36, borderRadius: ARAD.sm, background: a.selectedBg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <AIcon name={icon} size={18} color={a.selectedText} />
      </span>
      <div style={{ fontFamily: AFONT.sans, fontSize: 15, fontWeight: 600, color: a.text, marginTop: 12 }}>{title}</div>
      <div style={{ fontFamily: AFONT.sans, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: a.link, marginTop: 3 }}>{n}</div>
      <div style={{ fontFamily: AFONT.sans, fontSize: 12.5, color: a.subtle, marginTop: 7, lineHeight: 1.5 }}>{d}</div>
    </a>
  );
}

function useScrollSpy(ids) {
  const [active, setActive] = React.useState(ids[0]);
  React.useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: '-72px 0px -65% 0px', threshold: 0 });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);
  return active;
}

function AXApp() {
  const [t, setTval] = React.useState(() => {
    try { return { mode: 'light', accent: 'emerald', font: 'system', ...JSON.parse(localStorage.getItem('cognos-ax') || '{}') }; }
    catch (e) { return { mode: 'light', accent: 'emerald', font: 'system' }; }
  });
  const setT = (k, v) => setTval((s) => { const next = { ...s, [k]: v }; try { localStorage.setItem('cognos-ax', JSON.stringify(next)); } catch (e) {} return next; });
  const theme = React.useMemo(() => buildAtlas(t.mode, t.accent), [t.mode, t.accent]);
  const fontStack = FONT_STACKS[t.font] || FONT_STACKS.system;
  const active = useScrollSpy(AX_NAV.map((n) => n.id));

  React.useEffect(() => {
    document.body.style.background = theme.appBg;
    document.body.style.setProperty('--cog-font', fontStack);
  }, [theme.appBg, fontStack]);

  return (
    <ACtx.Provider value={theme}>
      <ToastProvider>
        <div style={{ minHeight: '100vh', background: theme.appBg, color: theme.text, '--cog-font': fontStack, fontFamily: fontStack }}>
          <AXTopBar t={t} setT={setT} />
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <AXSideNav active={active} />
            <main style={{ flex: 1, minWidth: 0, padding: '36px 44px 96px' }}>
              <div style={{ maxWidth: 1000, margin: '0 auto' }}>
                <OverviewSection />
                <FilesSection />
                <ImagesSection />
                <VaultSection />
                <ConvoSection />
                <footer style={{ borderTop: `1px solid ${theme.border}`, marginTop: 24, paddingTop: 22, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AIcon name="lock" size={13} color={theme.subtlest} />
                  <span style={{ fontFamily: fontStack, fontSize: 12.5, color: theme.subtlest }}>Cognos Design System · Component Extension v1 — extends the Atlassian / Emerald build</span>
                </footer>
              </div>
            </main>
          </div>
        </div>
      </ToastProvider>
    </ACtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AXApp />);
