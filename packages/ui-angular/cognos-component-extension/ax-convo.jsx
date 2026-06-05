// Cognos extension — conversation & system: code block, Vault citation/source
// cards, the "referencing N files" chip, and toast triggers.

// ── CodeBlock ───────────────────────────────────────────────────────────────
function CodeBlock({ code, lang = 'text', width = 480 }) {
  const a = useA();
  const [copied, setCopied] = React.useState(false);
  const copy = () => { try { navigator.clipboard.writeText(code); } catch (e) {} setCopied(true); setTimeout(() => setCopied(false), 1400); };
  return (
    <div style={{ width, maxWidth: '100%', borderRadius: ARAD.sm, border: `1px solid ${a.border}`, overflow: 'hidden', background: a.sunken }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 12px', background: a.surface, borderBottom: `1px solid ${a.border}` }}>
        <span style={{ fontFamily: MONO, fontSize: 11.5, color: a.subtlest, letterSpacing: '0.02em', flex: 1 }}>{lang}</span>
        <button onClick={copy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: ARAD.xs,
          border: 0, cursor: 'pointer', background: 'transparent', fontFamily: AFONT.sans, fontSize: 12, fontWeight: 500, color: copied ? a.successText : a.subtle }}
          onMouseEnter={(e) => { if (!copied) e.currentTarget.style.background = a.hover; }} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <AIcon name={copied ? 'check' : 'copy'} size={13} color={copied ? a.successText : a.subtle} />{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '13px 14px', overflow: 'auto', fontFamily: MONO, fontSize: 12.5, lineHeight: 1.65, color: a.text }}><code>{code}</code></pre>
    </div>
  );
}

// ── SourceCard: a Vault file the model cited ────────────────────────────────
function SourceCard({ file, locator, quote, onClick }) {
  const a = useA();
  const [h, hb] = aHover();
  return (
    <div {...hb} onClick={onClick} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 12px', borderRadius: ARAD.sm,
      border: `1px solid ${h ? a.borderBold : a.border}`, background: a.surface, cursor: 'pointer', transition: 'border-color 0.1s' }}>
      {file.img
        ? <span style={{ width: 30, height: 30, borderRadius: ARAD.xs, overflow: 'hidden', border: `1px solid ${a.border}`, flexShrink: 0 }}><img src={file.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></span>
        : <FileBadge ext={file.ext} size={30} radius={ARAD.xs} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontFamily: AFONT.sans, fontSize: 13, fontWeight: 600, color: a.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>
          {locator && <span style={{ fontFamily: MONO, fontSize: 11, color: a.subtlest, flexShrink: 0 }}>{locator}</span>}
        </div>
        {quote && (
          <div style={{ fontFamily: AFONT.sans, fontSize: 12.5, color: a.subtle, marginTop: 4, lineHeight: 1.45, borderLeft: `2px solid ${a.border}`, paddingLeft: 9 }}>“{quote}”</div>
        )}
      </div>
      <AIcon name="lock" size={12} color={a.successText} style={{ marginTop: 2 }} />
    </div>
  );
}

// ── SourcesRow: collapsible "N sources from your Vault" ─────────────────────
function SourcesRow({ sources, defaultOpen }) {
  const a = useA();
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent',
        cursor: 'pointer', padding: '2px 0', fontFamily: AFONT.sans, fontSize: 12.5, fontWeight: 600, color: a.link }}>
        <AIcon name="quote" size={13} color={a.link} />
        {sources.length} source{sources.length === 1 ? '' : 's'} from your Vault
        <AIcon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={a.link} />
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
          {sources.map((s, i) => <SourceCard key={i} file={s.file} locator={s.locator} quote={s.quote} onClick={() => {}} />)}
        </div>
      )}
    </div>
  );
}

// ── VaultRefChip: active references in composer / under a message ───────────
function VaultRefChip({ files, onClear, expandable }) {
  const a = useA();
  const [open, setOpen] = React.useState(false);
  const n = files.length;
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <span onClick={() => expandable && setOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 4px 0 10px',
        borderRadius: 9999, border: `1px solid ${a.selectedBorder}`, background: a.selectedBg, cursor: expandable ? 'pointer' : 'default' }}>
        <AIcon name="folder-lock" size={13} color={a.selectedText} />
        <span style={{ fontFamily: AFONT.sans, fontSize: 12.5, fontWeight: 600, color: a.selectedText }}>
          {n === 1 ? files[0].name : `Using ${n} files from your Vault`}
        </span>
        {expandable && <AIcon name={open ? 'chevron-up' : 'chevron-down'} size={13} color={a.selectedText} />}
        {onClear && (
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} title="Clear" style={{ width: 22, height: 22, borderRadius: 9999, border: 0, cursor: 'pointer',
            background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <AIcon name="x" size={13} color={a.selectedText} />
          </button>
        )}
      </span>
      {open && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 20, width: 280, padding: 8, background: a.surface,
          borderRadius: ARAD.sm, border: a.mode === 'dark' ? `1px solid ${a.border}` : 'none', boxShadow: a.shadowOverlay, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 4px' }}>
              <FileBadge ext={f.ext} size={26} radius={ARAD.xs} />
              <span style={{ flex: 1, minWidth: 0, fontFamily: AFONT.sans, fontSize: 13, color: a.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
              <AIcon name="lock" size={11} color={a.successText} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Assistant message citing Vault sources (assembled demo) ─────────────────
function AssistantSourcesDemo() {
  const a = useA();
  const mod = MODELS[0];
  return (
    <div style={{ display: 'flex', gap: 12, maxWidth: 600 }}>
      <span style={{ width: 28, height: 28, flexShrink: 0, marginTop: 1, borderRadius: 9999, background: a.brand, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AIcon name="lock" size={15} color={a.onBrand} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontFamily: AFONT.sans, fontSize: 14, fontWeight: 600, color: a.text }}>{mod.name}</span>
          <Lozenge tone="green">Encrypted</Lozenge>
          <span style={{ fontFamily: AFONT.sans, fontSize: 12, color: a.subtlest }}>14:38</span>
        </div>
        <div style={{ fontFamily: AFONT.sans, fontSize: 14, lineHeight: 1.6, color: a.text }}>
          Your tenancy runs month-to-month with a three-month notice period, and the deposit is capped at three months’ rent — both consistent with your bank records.
        </div>
        <SourcesRow defaultOpen sources={[
          { file: VAULT_FILES[0], locator: 'p. 4', quote: 'Either party may terminate with three months’ written notice to the end of a month.' },
          { file: VAULT_FILES[2], locator: 'rows 18–24', quote: 'Standing order “DEPOSIT” — CHF 4,950 paid 01.03.' },
        ]} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function ConvoSection() {
  const a = useA();
  const notify = useToast();
  const sampleCode = `from cognos import Vault\n\nvault = Vault.open(device_key)        # keys stay local\ndoc = vault.get("tenancy-agreement")  # decrypted in memory only\nanswer = model.ask(doc, "notice period?")`;
  return (
    <DocSection id="conversation" eyebrow="Conversation & system" title="In-message & system feedback"
      intro="The connective tissue: how a reply cites the encrypted files behind it, how active Vault references read in the composer, code that can be copied cleanly, and the quiet confirmations that close a loop.">

      <SubHead top={4}>Vault references</SubHead>
      <SpecGrid min={300}>
        <Spec title="VaultRefChip" desc="Shows which encrypted files a chat is drawing on. Single file names itself; multiples collapse to a count and expand to a list.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <VaultRefChip files={[VAULT_FILES[0]]} onClear={() => {}} />
            <VaultRefChip expandable files={[VAULT_FILES[0], VAULT_FILES[2], VAULT_FILES[4]]} onClear={() => {}} />
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: a.subtlest }}>CLICK THE COUNT TO EXPAND</span>
          </div>
        </Spec>
        <Spec title="SourceCard" desc="One cited file with a locator and an optional verbatim quote. Always wears its lock.">
          <div style={{ width: '100%', maxWidth: 320 }}>
            <SourceCard file={VAULT_FILES[0]} locator="p. 4" quote="…three months’ written notice to the end of a month." onClick={() => {}} />
          </div>
        </Spec>
      </SpecGrid>

      <SubHead>Cited reply</SubHead>
      <Spec align="flex-start" title="AssistantMessage + SourcesRow" desc="A grounded answer with its Vault sources expanded beneath — extends the existing assistant bubble, no restyle.">
        <AssistantSourcesDemo />
      </Spec>

      <SubHead>Code block</SubHead>
      <Spec align="flex-start" title="CodeBlock" desc="Monospace block with a language label and copy affordance; copy state confirms in green. Sits inside assistant messages.">
        <CodeBlock lang="python" code={sampleCode} width={520} />
      </Spec>

      <SubHead>Toasts & confirmation</SubHead>
      <Spec title="Toast" desc="Transient bottom-centre confirmation with an icon, optional action, and auto-dismiss. Trigger each tone below.">
        <AButton appearance="primary" icon="shield-check" onClick={() => notify({ title: 'Encrypted & saved to Vault', msg: 'Tenancy agreement.pdf · keys never left this device.' })}>Saved</AButton>
        <AButton appearance="default" icon="link" onClick={() => notify({ tone: 'info', icon: 'link', title: 'Share link copied', msg: 'Recipients still need the passphrase to decrypt.' })}>Link copied</AButton>
        <AButton appearance="default" icon="user-plus" onClick={() => notify({ title: 'Decrypt access granted', msg: 'L. Moreau can now open this chat.', action: { label: 'Undo' } })}>With action</AButton>
        <AButton appearance="danger" icon="shield-x" onClick={() => notify({ tone: 'danger', icon: 'shield-x', title: 'File shredded', msg: 'The key was destroyed — this file is gone for good.' })}>Shredded</AButton>
      </Spec>

      <SpecNote icon="quote" tone="info">Citations point to <strong>encrypted Vault files</strong>, not external URLs — the source of truth never leaves the person’s control, yet answers stay grounded and checkable.</SpecNote>
    </DocSection>
  );
}

Object.assign(window, { CodeBlock, SourceCard, SourcesRow, VaultRefChip, AssistantSourcesDemo, ConvoSection });
