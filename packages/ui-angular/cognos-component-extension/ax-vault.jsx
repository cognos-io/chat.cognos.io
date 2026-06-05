// Cognos extension — the Vault: a person's encrypted file store, referenced across
// chats. File cards (grid + list), storage meter, page + empty state, attach picker,
// crypto-shred confirm. "Vault" naming; parity with the existing institutional tone.

const VAULT_FILES = [
  { id: 'v1', name: 'Tenancy agreement.pdf', ext: 'pdf', size: '1.2 MB', meta: 'PDF · 9 pages', kind: 'doc', refs: 3, when: '2 weeks ago' },
  { id: 'v2', name: 'Health records 2025.pdf', ext: 'pdf', size: '4.6 MB', meta: 'PDF · 31 pages', kind: 'doc', refs: 1, when: 'Jan' },
  { id: 'v3', name: 'Bank statements Q1.csv', ext: 'csv', size: '88 KB', meta: '412 rows', kind: 'sheet', refs: 5, when: '3 days ago' },
  { id: 'v4', name: 'Passport scan.jpg', ext: 'jpg', size: '2.1 MB', meta: '3024 × 4032', kind: 'image', refs: 0, when: 'Apr', img: 'assets/bg-water-ripples.png' },
  { id: 'v5', name: 'Insurance policy.docx', ext: 'docx', size: '320 KB', meta: 'DOCX · 14 pages', kind: 'doc', refs: 2, when: 'May' },
  { id: 'v6', name: 'Voice memo — ideas.m4a', ext: 'm4a', size: '1.0 MB', meta: 'Audio · 3:12', kind: 'audio', refs: 0, when: 'Yesterday' },
];

// ── VaultCard: grid tile ────────────────────────────────────────────────────
function VaultCard({ file, selectable, selected, onToggle, onMore, onClick }) {
  const a = useA();
  const [h, hb] = aHover();
  const act = selectable ? onToggle : onClick;
  return (
    <div {...hb} onClick={act} style={{ position: 'relative', textAlign: 'left', cursor: act ? 'pointer' : 'default',
      border: `1px solid ${selected ? a.selectedBorder : h ? a.borderBold : a.border}`, borderRadius: ARAD.md,
      background: selected ? a.selectedBg : a.surface, padding: 13, boxShadow: h && !selected ? a.shadowRaised : 'none',
      transition: 'border-color 0.1s, box-shadow 0.1s', display: 'flex', flexDirection: 'column', gap: 11, minHeight: 124 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        {file.img
          ? <span style={{ width: 40, height: 40, borderRadius: ARAD.sm, overflow: 'hidden', border: `1px solid ${a.border}`, flexShrink: 0 }}><img src={file.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></span>
          : <FileBadge ext={file.ext} size={40} />}
        {selectable
          ? <span style={{ width: 20, height: 20, borderRadius: 9999, flexShrink: 0, border: `2px solid ${selected ? a.brand : a.borderBold}`,
              background: selected ? a.brand : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {selected && <AIcon name="check" size={12} color={a.onBrand} strokeWidth={3} />}
            </span>
          : (h || onMore) && <AIconBtn name="more-horizontal" size={15} title="More" onClick={(e) => { e.stopPropagation(); onMore && onMore(); }} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: AFONT.sans, fontSize: 13.5, fontWeight: 600, color: a.text, lineHeight: 1.35,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{file.name}</div>
        <div style={{ fontFamily: AFONT.sans, fontSize: 12, color: a.subtlest, marginTop: 3 }}>{file.size} · {file.meta}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 9, borderTop: `1px solid ${selected ? 'transparent' : a.border}` }}>
        <span style={{ flex: 1, minWidth: 0, fontFamily: AFONT.sans, fontSize: 11.5, color: file.refs ? a.link : a.subtlest, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <AIcon name="link" size={12} color={file.refs ? a.link : a.subtlest} />
          {file.refs ? `In ${file.refs} chat${file.refs === 1 ? '' : 's'}` : 'Not referenced'}
        </span>
        <AIcon name="lock" size={12} color={a.successText} />
      </div>
    </div>
  );
}

// ── VaultListRow: dense list layout ─────────────────────────────────────────
function VaultListRow({ file, top, onMore, onClick }) {
  const a = useA();
  const [h, hb] = aHover();
  return (
    <div {...hb} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 13px', cursor: onClick ? 'pointer' : 'default',
      borderTop: top ? `1px solid ${a.border}` : 0, background: h ? a.hover : 'transparent', transition: 'background 0.1s' }}>
      {file.img
        ? <span style={{ width: 34, height: 34, borderRadius: ARAD.sm, overflow: 'hidden', border: `1px solid ${a.border}`, flexShrink: 0 }}><img src={file.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></span>
        : <FileBadge ext={file.ext} size={34} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: AFONT.sans, fontSize: 13.5, fontWeight: 500, color: a.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
        <div style={{ fontFamily: AFONT.sans, fontSize: 12, color: a.subtlest, marginTop: 1 }}>{file.size} · {file.meta} · {file.when}</div>
      </div>
      <span style={{ fontFamily: AFONT.sans, fontSize: 11.5, color: file.refs ? a.link : a.subtlest, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
        <AIcon name="link" size={12} color={file.refs ? a.link : a.subtlest} /> {file.refs ? `${file.refs} chats` : '—'}
      </span>
      <AIcon name="lock" size={13} color={a.successText} />
      <AIconBtn name="more-horizontal" size={15} title="More" onClick={(e) => { e.stopPropagation(); onMore && onMore(); }} />
    </div>
  );
}

// ── StorageMeter: encrypted usage by type ───────────────────────────────────
function StorageMeter({ width }) {
  const a = useA();
  const segs = [
    { label: 'Documents', tone: 'blue', pct: 17 },
    { label: 'Images', tone: 'purple', pct: 9 },
    { label: 'Sheets', tone: 'green', pct: 4 },
    { label: 'Audio', tone: 'red', pct: 2 },
  ];
  return (
    <div style={{ width, padding: '14px 16px', borderRadius: ARAD.md, background: a.surface, border: `1px solid ${a.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontFamily: AFONT.sans, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: a.subtlest, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <AIcon name="hard-drive" size={14} color={a.subtle} /> Vault storage
        </span>
        <span style={{ fontFamily: AFONT.sans, fontSize: 12.5, color: a.subtle }}><strong style={{ color: a.text, fontWeight: 600 }}>1.6 GB</strong> of 5 GB</span>
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 9999, overflow: 'hidden', background: a.mode === 'dark' ? a.pressed : a.neutralHover, gap: 2 }}>
        {segs.map((s) => <span key={s.label} style={{ width: `${s.pct}%`, background: lozTone(a, s.tone)[1] }} />)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 11 }}>
        {segs.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: AFONT.sans, fontSize: 12, color: a.subtle }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: lozTone(a, s.tone)[1] }} />{s.label}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: AFONT.sans, fontSize: 11.5, color: a.subtlest, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <AIcon name="lock" size={11} color={a.subtlest} /> Encrypted on this device
        </span>
      </div>
    </div>
  );
}

// ── Filter chips ────────────────────────────────────────────────────────────
function FilterChips({ value, onChange }) {
  const a = useA();
  const opts = [['all', 'All'], ['doc', 'Documents'], ['image', 'Images'], ['sheet', 'Sheets'], ['audio', 'Audio']];
  return (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
      {opts.map(([v, l]) => {
        const on = v === value;
        return (
          <button key={v} onClick={() => onChange(v)} style={{ height: 30, padding: '0 12px', borderRadius: 9999, cursor: 'pointer',
            border: `1px solid ${on ? a.selectedBorder : a.border}`, background: on ? a.selectedBg : a.surface,
            fontFamily: AFONT.sans, fontSize: 13, fontWeight: on ? 600 : 400, color: on ? a.selectedText : a.subtle, transition: 'background 0.1s' }}>{l}</button>
        );
      })}
    </div>
  );
}

// ── VaultPage: full screen mock (and empty state) ───────────────────────────
function VaultPage({ empty }) {
  const a = useA();
  const [filter, setFilter] = React.useState('all');
  const [view, setView] = React.useState('grid');
  const [q, setQ] = React.useState('');
  const files = VAULT_FILES.filter((f) => filter === 'all' || f.kind === filter).filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ width: '100%', background: a.appBg, borderRadius: ARAD.md, overflow: 'hidden', border: `1px solid ${a.border}` }}>
      {/* header */}
      <div style={{ background: a.surface, borderBottom: `1px solid ${a.border}`, padding: '14px 20px 16px' }}>
        <Breadcrumbs items={[{ label: 'Cognos' }, { label: 'Vault' }]} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginTop: 6 }}>
          <span style={{ width: 40, height: 40, borderRadius: ARAD.sm, flexShrink: 0, background: a.selectedBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AIcon name="folder-lock" size={20} color={a.selectedText} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontFamily: AFONT.sans, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', color: a.text }}>Vault</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span style={{ fontFamily: AFONT.sans, fontSize: 13, color: a.subtle }}>{VAULT_FILES.length} files · personal to you</span>
              <Lozenge tone="green">Encrypted</Lozenge>
            </div>
          </div>
          <AButton appearance="primary" icon="upload">Add files</AButton>
        </div>
      </div>

      {empty ? (
        <div style={{ padding: '40px 28px 48px', maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          <span style={{ width: 56, height: 56, borderRadius: ARAD.md, background: a.selectedBg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <AIcon name="folder-lock" size={28} color={a.selectedText} />
          </span>
          <h2 style={{ margin: 0, fontFamily: AFONT.sans, fontSize: 20, fontWeight: 600, color: a.text }}>Your Vault is empty</h2>
          <p style={{ fontFamily: AFONT.sans, fontSize: 14, color: a.subtle, lineHeight: 1.55, margin: '8px auto 22px', maxWidth: 420 }}>
            Add documents, images or notes once and reference them in any chat. Everything is encrypted on this device — only you hold the keys.
          </p>
          <Dropzone />
        </div>
      ) : (
        <div style={{ padding: '16px 20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 220, maxWidth: '100%' }}><AField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the Vault" icon="search" /></div>
            <FilterChips value={filter} onChange={setFilter} />
            <span style={{ flex: 1 }} />
            <Seg value={view} size="sm" onChange={setView} options={[{ value: 'grid', icon: 'layout-grid' }, { value: 'list', icon: 'list' }]} />
          </div>
          <div style={{ marginBottom: 14 }}><StorageMeter width="100%" /></div>
          {view === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
              {files.map((f) => <VaultCard key={f.id} file={f} onMore={() => {}} onClick={() => {}} />)}
            </div>
          ) : (
            <div style={{ borderRadius: ARAD.md, background: a.surface, border: `1px solid ${a.border}`, overflow: 'hidden' }}>
              {files.map((f, i) => <VaultListRow key={f.id} file={f} top={i > 0} onMore={() => {}} onClick={() => {}} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── VaultPicker: attach-from-Vault modal ────────────────────────────────────
function VaultPicker({ onClose }) {
  const a = useA();
  const [sel, setSel] = React.useState({ v1: true, v3: true });
  const [q, setQ] = React.useState('');
  const toggle = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const count = Object.values(sel).filter(Boolean).length;
  const files = VAULT_FILES.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <AModal onClose={onClose} width={520} title="Attach from your Vault">
      <div style={{ padding: '4px 24px 4px' }}>
        <div style={{ fontFamily: AFONT.sans, fontSize: 13.5, color: a.subtle, lineHeight: 1.5, marginBottom: 14 }}>
          Reference encrypted files in this chat. They’re decrypted on your device only when the model needs them, then sealed again.
        </div>
        <AField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the Vault" icon="search" />
        <div style={{ marginTop: 12, maxHeight: 320, overflow: 'auto', borderRadius: ARAD.sm, border: `1px solid ${a.border}` }}>
          {files.map((f, i) => (
            <button key={f.id} onClick={() => toggle(f.id)} style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer',
              borderTop: i ? `1px solid ${a.border}` : 0, background: sel[f.id] ? a.selectedBg : 'transparent', padding: '10px 13px',
              display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 20, height: 20, borderRadius: ARAD.xs, flexShrink: 0, border: `2px solid ${sel[f.id] ? a.brand : a.borderBold}`,
                background: sel[f.id] ? a.brand : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {sel[f.id] && <AIcon name="check" size={12} color={a.onBrand} strokeWidth={3} />}
              </span>
              {f.img
                ? <span style={{ width: 30, height: 30, borderRadius: ARAD.xs, overflow: 'hidden', border: `1px solid ${a.border}`, flexShrink: 0 }}><img src={f.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></span>
                : <FileBadge ext={f.ext} size={30} radius={ARAD.xs} />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: AFONT.sans, fontSize: 13.5, fontWeight: 500, color: a.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                <span style={{ display: 'block', fontFamily: AFONT.sans, fontSize: 12, color: a.subtlest, marginTop: 1 }}>{f.size} · {f.meta}</span>
              </span>
              <AIcon name="lock" size={12} color={a.successText} />
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '16px 24px 20px' }}>
        <span style={{ fontFamily: AFONT.sans, fontSize: 13, color: a.subtle }}>{count} selected</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <AButton appearance="subtle" onClick={onClose}>Cancel</AButton>
          <AButton appearance="primary" icon="paperclip" onClick={onClose}>Attach {count || ''}</AButton>
        </div>
      </div>
    </AModal>
  );
}

// ── ConfirmShred: irreversible crypto-shred ─────────────────────────────────
function ConfirmShred({ file, onClose }) {
  const a = useA();
  const f = file || VAULT_FILES[1];
  const [red] = [lozTone(a, 'red')];
  return (
    <AModal onClose={onClose} width={460}>
      <div style={{ padding: '24px 24px 8px' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 9999, background: red[0], display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <AIcon name="shield-x" size={20} color={red[1]} />
          </span>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontFamily: AFONT.sans, fontSize: 18, fontWeight: 600, color: a.text }}>Shred this file?</h2>
            <p style={{ fontFamily: AFONT.sans, fontSize: 13.5, color: a.subtle, lineHeight: 1.55, margin: '8px 0 0' }}>
              Shredding destroys the encryption key for <strong style={{ color: a.text, fontWeight: 600 }}>{f.name}</strong>. The ciphertext can never be opened again — not by you, not by anyone with whom it was shared, not by Cognos.
            </p>
          </div>
        </div>
        <div style={{ marginTop: 16, marginLeft: 54 }}>
          <DocAttachment name={f.name} ext={f.ext} size={f.size} meta={f.meta} width="100%" />
        </div>
        {f.refs > 0 && (
          <div style={{ marginTop: 12, marginLeft: 54 }}>
            <SectionMessage tone="info" icon="link">It’s referenced in {f.refs} chat{f.refs === 1 ? '' : 's'}. Those messages will keep their text, but the file behind them will be unrecoverable.</SectionMessage>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px 20px' }}>
        <AButton appearance="subtle" onClick={onClose}>Cancel</AButton>
        <AButton appearance="danger" icon="shield-x" onClick={onClose}>Shred permanently</AButton>
      </div>
    </AModal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function VaultSection() {
  const a = useA();
  const [modal, setModal] = React.useState(null);
  return (
    <DocSection id="vault" eyebrow="The Vault" title="Vault — your encrypted files"
      intro="A personal store of encrypted files you reference across chats. Upload once; the model can draw on a document in any conversation without it ever leaving your control. Files are individually keyed, so a single one can be shredded beyond recovery.">

      <SubHead top={4}>File card — grid & list</SubHead>
      <SpecGrid min={300}>
        <Spec title="VaultCard (grid)" desc="Type badge or image thumbnail, name, size, and a reference count linking back to the chats that use it. Hover reveals the overflow menu.">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%' }}>
            <VaultCard file={VAULT_FILES[0]} onMore={() => {}} />
            <VaultCard file={VAULT_FILES[3]} onMore={() => {}} />
          </div>
        </Spec>
        <Spec title="VaultListRow + selected" desc="Dense alternative for long vaults, plus the selectable state used by the picker.">
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ borderRadius: ARAD.md, background: a.surface, border: `1px solid ${a.border}`, overflow: 'hidden' }}>
              <VaultListRow file={VAULT_FILES[2]} onMore={() => {}} />
              <VaultListRow file={VAULT_FILES[5]} top onMore={() => {}} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <VaultCard file={VAULT_FILES[4]} selectable selected onToggle={() => {}} />
            </div>
          </div>
        </Spec>
      </SpecGrid>

      <SubHead>Storage meter</SubHead>
      <Spec title="StorageMeter" desc="Encrypted usage broken down by file type, reusing lozenge tones as the legend.">
        <StorageMeter width={520} />
      </Spec>

      <SubHead>Full page</SubHead>
      <Spec align="stretch" pad="22px" title="VaultPage" desc="The assembled screen: breadcrumb header, search, type filters, grid/list toggle, storage meter, and cards. Switch the layout with the toggle, top-right.">
        <VaultPage />
      </Spec>

      <SubHead>Empty state</SubHead>
      <Spec align="stretch" pad="22px" title="VaultPage · empty" desc="First-run state leads straight into the encrypted dropzone with a plain-language promise.">
        <VaultPage empty />
      </Spec>

      <SubHead>Picker & destructive confirm</SubHead>
      <Spec title="VaultPicker · ConfirmShred" desc="Multi-select picker for attaching vault files to a chat, and the irreversible crypto-shred dialog. Open each below.">
        <AButton appearance="default" icon="folder-lock" onClick={() => setModal('pick')}>Attach from Vault</AButton>
        <AButton appearance="danger" icon="shield-x" onClick={() => setModal('shred')}>Shred a file</AButton>
      </Spec>

      <SpecNote icon="key-round" tone="info">Per-file keys make <strong>crypto-shredding</strong> a real delete: destroy the key and the bytes are noise forever. This is the privacy-first answer to “are you sure you want to delete?”.</SpecNote>

      {modal === 'pick' && <VaultPicker onClose={() => setModal(null)} />}
      {modal === 'shred' && <ConfirmShred onClose={() => setModal(null)} />}
    </DocSection>
  );
}

Object.assign(window, { VAULT_FILES, VaultCard, VaultListRow, StorageMeter, FilterChips, VaultPage, VaultPicker, ConfirmShred, VaultSection });
