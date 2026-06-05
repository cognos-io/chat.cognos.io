// Cognos extension — file system: type badges, document attachment cards
// (encrypting → sealed → error), progress, drag-drop dropzone, upload rows, voice note.

// ── File-type registry ──────────────────────────────────────────────────────
const FILE_TYPES = {
  pdf:  { icon: 'file-text', tone: 'red',     label: 'PDF' },
  docx: { icon: 'file-text', tone: 'blue',    label: 'DOCX' },
  doc:  { icon: 'file-text', tone: 'blue',    label: 'DOC' },
  txt:  { icon: 'file-text', tone: 'neutral', label: 'TXT' },
  md:   { icon: 'file-text', tone: 'neutral', label: 'MD' },
  rtf:  { icon: 'file-text', tone: 'neutral', label: 'RTF' },
  csv:  { icon: 'table',     tone: 'green',   label: 'CSV' },
  xlsx: { icon: 'table',     tone: 'green',   label: 'XLSX' },
  png:  { icon: 'image',     tone: 'purple',  label: 'PNG' },
  jpg:  { icon: 'image',     tone: 'purple',  label: 'JPG' },
  jpeg: { icon: 'image',     tone: 'purple',  label: 'JPG' },
  webp: { icon: 'image',     tone: 'purple',  label: 'WEBP' },
  mp3:  { icon: 'music',     tone: 'purple',  label: 'MP3' },
  wav:  { icon: 'music',     tone: 'purple',  label: 'WAV' },
  m4a:  { icon: 'music',     tone: 'purple',  label: 'M4A' },
};
function fileType(ext) { return FILE_TYPES[String(ext || '').toLowerCase()] || { icon: 'file', tone: 'neutral', label: String(ext || 'FILE').toUpperCase() }; }
function lozTone(a, tone) {
  const m = {
    neutral: [a.lozNeutralBg, a.lozNeutralText],
    blue: [a.lozBlueBg, a.lozBlueText],
    green: [a.lozGreenBg, a.lozGreenText],
    purple: [a.lozPurpleBg, a.lozPurpleText],
    red: a.mode === 'dark' ? ['#5D1F1A', '#FF9C8F'] : ['#FFEDEB', '#AE2A19'],
  };
  return m[tone] || m.neutral;
}

// ── FileBadge: tinted rounded square with the type glyph ────────────────────
function FileBadge({ ext, size = 38, radius = ARAD.sm }) {
  const a = useA();
  const ft = fileType(ext);
  const [bg, fg] = lozTone(a, ft.tone);
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: radius, background: bg, color: fg,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <AIcon name={ft.icon} size={Math.round(size * 0.48)} color={fg} />
    </span>
  );
}

// ── Progress bar (determinate or indeterminate) ─────────────────────────────
function AProgress({ value = 0, indeterminate, height = 4, tone }) {
  const a = useA();
  const c = tone || a.brand;
  const track = a.mode === 'dark' ? a.pressed : a.neutralHover;
  return (
    <div style={{ height, borderRadius: 9999, background: track, overflow: 'hidden', width: '100%', position: 'relative' }}>
      {indeterminate
        ? <span style={{ position: 'absolute', top: 0, bottom: 0, width: '40%', borderRadius: 9999, background: c, animation: 'aShimmer 1.1s ease-in-out infinite' }} />
        : <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, value))}%`, borderRadius: 9999, background: c, transition: 'width 0.25s ease-out' }} />}
    </div>
  );
}

// ── DocAttachment: a sealed/encrypting/error file card in a message or list ─
function DocAttachment({ name = 'document.pdf', ext, size = '320 KB', meta, state = 'sealed', progress = 0,
  onRemove, onClick, width = 280, trailing }) {
  const a = useA();
  const [h, hb] = aHover();
  const realExt = ext || (name.includes('.') ? name.split('.').pop() : 'file');
  const clickable = !!onClick;
  return (
    <div {...(clickable ? hb : {})} onClick={onClick} style={{ width, maxWidth: '100%', boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', gap: 11, padding: '10px 11px', borderRadius: ARAD.sm,
      border: `1px solid ${state === 'error' ? a.danger : h ? a.borderBold : a.border}`, background: a.surface,
      cursor: clickable ? 'pointer' : 'default', transition: 'border-color 0.1s', position: 'relative', overflow: 'hidden' }}>
      <FileBadge ext={realExt} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: AFONT.sans, fontSize: 13.5, fontWeight: 500, color: a.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        {state === 'encrypting' ? (
          <div style={{ marginTop: 6 }}>
            <AProgress value={progress} height={4} />
            <div style={{ fontFamily: AFONT.sans, fontSize: 11, color: a.subtlest, marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
              <AIcon name="loader" size={11} color={a.subtlest} /> Encrypting on this device · {Math.round(progress)}%
            </div>
          </div>
        ) : state === 'error' ? (
          <div style={{ fontFamily: AFONT.sans, fontSize: 11.5, color: a.danger, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
            <AIcon name="triangle-alert" size={12} color={a.danger} /> Couldn’t encrypt — tap to retry
          </div>
        ) : (
          <div style={{ fontFamily: AFONT.sans, fontSize: 11.5, color: a.subtlest, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{(meta || (fileType(realExt).label + ' · ' + size))}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: a.successText }}>
              <AIcon name="lock" size={11} color={a.successText} /> Encrypted
            </span>
          </div>
        )}
      </div>
      {trailing}
      {onRemove && state !== 'encrypting' && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove" style={{ width: 24, height: 24, flexShrink: 0,
          border: 0, cursor: 'pointer', background: 'transparent', borderRadius: ARAD.xs, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <AIcon name="x" size={14} color={a.subtlest} />
        </button>
      )}
    </div>
  );
}

// ── AttachChip: compact staged-file pill (composer tray) ────────────────────
function AttachChip({ name, ext, state = 'sealed', onRemove }) {
  const a = useA();
  const realExt = ext || (name.includes('.') ? name.split('.').pop() : 'file');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 6px 0 7px',
      borderRadius: ARAD.sm, border: `1px solid ${a.border}`, background: a.surface, maxWidth: 220 }}>
      <FileBadge ext={realExt} size={22} radius={ARAD.xs} />
      <span style={{ fontFamily: AFONT.sans, fontSize: 12.5, color: a.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      {state === 'encrypting'
        ? <AIcon name="loader" size={12} color={a.subtlest} />
        : <AIcon name="lock" size={11} color={a.successText} />}
      {onRemove && (
        <button onClick={onRemove} title="Remove" style={{ width: 20, height: 20, flexShrink: 0, border: 0, cursor: 'pointer',
          background: 'transparent', borderRadius: ARAD.xs, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <AIcon name="x" size={13} color={a.subtlest} />
        </button>
      )}
    </span>
  );
}

// ── Dropzone: drag-and-drop upload target ───────────────────────────────────
function Dropzone({ onFiles, compact }) {
  const a = useA();
  const [over, setOver] = React.useState(false);
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles && onFiles(); }}
      style={{ borderRadius: ARAD.md, border: `2px dashed ${over ? a.brand : a.borderBold}`, background: over ? a.selectedBg : a.surface,
        padding: compact ? '20px 18px' : '32px 24px', textAlign: 'center', transition: 'background 0.12s, border-color 0.12s', cursor: 'pointer' }}
      onClick={() => onFiles && onFiles()}>
      <span style={{ width: 46, height: 46, borderRadius: 9999, background: over ? a.surface : a.selectedBg, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <AIcon name={over ? 'lock' : 'upload-cloud'} size={22} color={a.selectedText} />
      </span>
      <div style={{ fontFamily: AFONT.sans, fontSize: 15, fontWeight: 600, color: a.text }}>
        {over ? 'Drop to encrypt & add' : 'Drag files here to add to your Vault'}
      </div>
      <div style={{ fontFamily: AFONT.sans, fontSize: 13, color: a.subtle, marginTop: 4 }}>
        or <span style={{ color: a.link, fontWeight: 600 }}>browse your device</span> · PDF, DOCX, images, CSV, audio
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, fontFamily: AFONT.sans, fontSize: 11.5, color: a.subtlest }}>
        <AIcon name="lock" size={12} color={a.subtlest} /> Files are encrypted on this device before they’re stored
      </div>
    </div>
  );
}

// ── UploadRow: in-flight encrypting file with cancel ────────────────────────
function UploadRow({ name, ext, progress, done, onCancel }) {
  const a = useA();
  const realExt = ext || (name.includes('.') ? name.split('.').pop() : 'file');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: ARAD.sm, border: `1px solid ${a.border}`, background: a.surface }}>
      <FileBadge ext={realExt} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: AFONT.sans, fontSize: 13, fontWeight: 500, color: a.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: done ? a.successText : a.subtlest }}>{done ? 'Sealed' : Math.round(progress) + '%'}</span>
        </div>
        <div style={{ marginTop: 6 }}><AProgress value={progress} tone={done ? a.success : undefined} /></div>
        <div style={{ fontFamily: AFONT.sans, fontSize: 11, color: a.subtlest, marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
          {done ? <><AIcon name="lock" size={11} color={a.successText} /> Encrypted on this device</> : <><AIcon name="loader" size={11} color={a.subtlest} /> Sealing…</>}
        </div>
      </div>
      {!done && onCancel && (
        <button onClick={onCancel} title="Cancel" style={{ width: 26, height: 26, flexShrink: 0, border: 0, cursor: 'pointer', background: 'transparent', borderRadius: ARAD.xs, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <AIcon name="x" size={15} color={a.subtlest} />
        </button>
      )}
    </div>
  );
}

// ── AudioNote: encrypted voice note ─────────────────────────────────────────
function AudioNote({ duration = '0:42', playing: playInit, width = 280 }) {
  const a = useA();
  const [playing, setPlaying] = React.useState(!!playInit);
  const bars = [6, 11, 18, 9, 22, 14, 26, 17, 9, 20, 28, 13, 7, 19, 24, 11, 16, 8, 21, 14, 10, 23, 17, 9, 13, 7];
  return (
    <div style={{ width, maxWidth: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px 9px 9px', borderRadius: ARAD.md, border: `1px solid ${a.border}`, background: a.surface }}>
      <button onClick={() => setPlaying((p) => !p)} style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 9999, border: 0, cursor: 'pointer',
        background: a.brand, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <AIcon name={playing ? 'pause' : 'play'} size={16} color={a.onBrand} />
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, height: 30 }}>
        {bars.map((b, i) => (
          <span key={i} style={{ flex: 1, height: b, minWidth: 2, borderRadius: 9999,
            background: playing && i < 11 ? a.brand : a.borderBold, opacity: playing && i < 11 ? 1 : 0.7 }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: a.subtle }}>{duration}</span>
        <AIcon name="lock" size={11} color={a.successText} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION
// ════════════════════════════════════════════════════════════════════════════
function DemoEncrypt() {
  const [p, setP] = React.useState(0);
  const [sealed, setSealed] = React.useState(false);
  React.useEffect(() => {
    let v = 0; setSealed(false); setP(0);
    const t = setInterval(() => {
      v += 7 + Math.random() * 9;
      if (v >= 100) { v = 100; setP(100); clearInterval(t); setTimeout(() => setSealed(true), 450); }
      else setP(v);
    }, 280);
    return () => clearInterval(t);
  }, []);
  return <DocAttachment name="Procurement-2026.pdf" size="2.4 MB" meta="PDF · 18 pages" state={sealed ? 'sealed' : 'encrypting'} progress={p} width={300} />;
}

function DemoUploadList() {
  const notify = useToast();
  const [rows, setRows] = React.useState(null);
  const start = () => {
    const seed = [
      { id: 1, name: 'Tenancy-agreement.pdf', p: 0 },
      { id: 2, name: 'Bank-statement-Q1.csv', p: 0 },
      { id: 3, name: 'Passport-scan.jpg', p: 0 },
    ];
    setRows(seed);
    const t = setInterval(() => {
      setRows((rs) => {
        if (!rs) return rs;
        const next = rs.map((r) => ({ ...r, p: Math.min(100, r.p + 8 + Math.random() * 12) }));
        if (next.every((r) => r.p >= 100)) { clearInterval(t); setTimeout(() => notify({ title: '3 files encrypted & added to Vault', msg: 'Keys never left this device.', icon: 'shield-check' }), 350); }
        return next;
      });
    }, 320);
  };
  return (
    <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!rows
        ? <Dropzone onFiles={start} />
        : rows.map((r) => <UploadRow key={r.id} name={r.name} progress={r.p} done={r.p >= 100} onCancel={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} />)}
      {rows && <AButton appearance="subtle" icon="rotate-cw" onClick={() => setRows(null)} style={{ alignSelf: 'flex-start' }}>Reset demo</AButton>}
    </div>
  );
}

function FilesSection() {
  const a = useA();
  return (
    <DocSection id="files" eyebrow="Attachments & upload" title="Files & documents"
      intro="Anything a person attaches — a contract, a spreadsheet, a scan — is sealed on the device before it’s stored or sent. These components carry that promise visibly: a type badge, an honest encrypting state, and a quiet lock once sealed.">

      <SubHead top={4}>File-type badge</SubHead>
      <Spec title="FileBadge" desc="Tinted rounded square mapping a file extension to a Lucide glyph and a lozenge tone. Sizes 22 / 28 / 38 / 48. Tones reuse the system palette — no new colours.">
        {['pdf', 'docx', 'txt', 'csv', 'xlsx', 'png', 'jpg', 'mp3', 'zip'].map((e) => (
          <Variant key={e} label={fileType(e).label}><FileBadge ext={e} size={44} /></Variant>
        ))}
      </Spec>

      <SubHead>Document attachment — states</SubHead>
      <Spec align="flex-start" title="DocAttachment" desc="Used inside a message bubble and in lists. The card never claims to be encrypted while it is still sealing — the encrypting state shows on-device progress, then settles to a quiet green lock.">
        <Variant label="Sealed" align="stretch"><DocAttachment name="Cantonal-DPA-guidance.pdf" size="1.1 MB" meta="PDF · 12 pages" width={300} /></Variant>
        <Variant label="Encrypting" align="stretch"><DemoEncrypt /></Variant>
        <Variant label="Error" align="stretch"><DocAttachment name="Scan_0042.tiff" size="—" state="error" width={300} onClick={() => {}} /></Variant>
      </Spec>

      <SubHead>Drag-and-drop & upload progress</SubHead>
      <Spec align="flex-start" title="Dropzone → UploadRow" desc="Idle and drag-over states, then per-file on-device encryption progress. Drag a file in, or use the demo button to watch the seal-and-confirm flow end in a toast.">
        <DemoUploadList />
      </Spec>

      <SubHead>Voice note & raw progress</SubHead>
      <SpecGrid min={320}>
        <Spec title="AudioNote" desc="Encrypted voice memo with a scrubbable waveform. Tap play to preview.">
          <AudioNote />
        </Spec>
        <Spec title="AttachChip · Progress" desc="Compact staged-file pill for the composer tray, plus the bare progress bar (determinate + indeterminate).">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 300 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <AttachChip name="brief.docx" onRemove={() => {}} />
              <AttachChip name="notes.md" state="encrypting" />
            </div>
            <AProgress value={64} />
            <AProgress indeterminate />
          </div>
        </Spec>
      </SpecGrid>

      <SpecNote icon="lock" tone="success">Every file component resolves to the same end-state: a green <strong>lock + “Encrypted”</strong>. The encrypting state is the only place we expose progress — never fake a sealed badge before the keys are written.</SpecNote>
    </DocSection>
  );
}

Object.assign(window, { FILE_TYPES, fileType, lozTone, FileBadge, AProgress, DocAttachment, AttachChip, Dropzone, UploadRow, AudioNote, FilesSection });
