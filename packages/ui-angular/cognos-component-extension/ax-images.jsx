// Cognos extension — images: user-uploaded attachments (grid + lightbox),
// model-generated images (provenance + actions), and the composer staging tray.

const IMG_RIPPLE = 'assets/bg-water-ripples.png';
const IMG_COSMOS = 'assets/bg-cosmos.png';

// ── ImageThumb: a single encrypted image cell ───────────────────────────────
function ImageThumb({ src, onClick, height = 132, round = ARAD.md, cover = true, lock = true, more }) {
  const a = useA();
  const [h, hb] = aHover();
  return (
    <button {...hb} onClick={onClick} style={{ position: 'relative', display: 'block', padding: 0, border: `1px solid ${a.border}`,
      borderRadius: round, overflow: 'hidden', cursor: 'pointer', background: a.sunken, width: '100%', height: cover ? height : 'auto', lineHeight: 0 }}>
      <img src={src} alt="" style={{ width: '100%', height: cover ? '100%' : 'auto', objectFit: cover ? 'cover' : 'contain', display: 'block',
        filter: h ? 'brightness(0.94)' : 'none', transition: 'filter 0.12s' }} />
      {lock && (
        <span style={{ position: 'absolute', left: 7, bottom: 7, width: 22, height: 22, borderRadius: 9999,
          background: 'rgba(9,30,66,0.62)', backdropFilter: 'blur(4px)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <AIcon name="lock" size={12} color="#FFFFFF" />
        </span>
      )}
      {more > 0 && (
        <span style={{ position: 'absolute', inset: 0, background: 'rgba(9,30,66,0.58)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: AFONT.sans, fontSize: 22, fontWeight: 600, color: '#FFFFFF' }}>+{more}</span>
      )}
    </button>
  );
}

// ── ImageGrid: 1–N attached photos in a message ─────────────────────────────
function ImageGrid({ images, onOpen, max = 4, width = 320 }) {
  const shown = images.slice(0, max);
  const extra = images.length - shown.length;
  const n = shown.length;
  if (n === 1) {
    return (
      <button onClick={() => onOpen(0)} style={{ display: 'block', padding: 0, border: 0, background: 'transparent', cursor: 'pointer', lineHeight: 0, maxWidth: width }}>
        <ImageThumbInline src={shown[0]} />
      </button>
    );
  }
  const cols = n === 2 ? '1fr 1fr' : n === 3 ? '1fr 1fr' : '1fr 1fr';
  return (
    <div style={{ width, maxWidth: '100%', display: 'grid', gridTemplateColumns: cols, gap: 3 }}>
      {shown.map((src, i) => {
        const span2 = n === 3 && i === 0;
        return (
          <div key={i} style={{ gridColumn: span2 ? '1 / -1' : 'auto' }}>
            <ImageThumb src={src} height={span2 ? 150 : 116} onClick={() => onOpen(i)} more={i === shown.length - 1 ? extra : 0} />
          </div>
        );
      })}
    </div>
  );
}
function ImageThumbInline({ src }) {
  const a = useA();
  return (
    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: ARAD.md, border: `1px solid ${a.border}`, display: 'block' }} />
      <span style={{ position: 'absolute', left: 8, bottom: 8, display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px',
        borderRadius: 9999, background: 'rgba(9,30,66,0.62)', backdropFilter: 'blur(4px)', fontFamily: AFONT.sans, fontSize: 11, fontWeight: 600, color: '#FFFFFF' }}>
        <AIcon name="lock" size={11} color="#FFFFFF" /> Encrypted
      </span>
    </span>
  );
}

// ── Lightbox: full-screen encrypted viewer ──────────────────────────────────
function Lightbox({ src, name = 'image.png', onClose }) {
  const a = useA();
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(9,30,66,0.82)',
      display: 'flex', flexDirection: 'column', animation: 'aFade 0.12s ease-out' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', color: '#FFFFFF' }}>
        <AIcon name="image" size={16} color="rgba(255,255,255,0.8)" />
        <span style={{ fontFamily: AFONT.sans, fontSize: 14, fontWeight: 500, color: '#FFFFFF' }}>{name}</span>
        <Lozenge tone="green">Encrypted</Lozenge>
        <span style={{ flex: 1 }} />
        <LightboxBtn icon="download" title="Download" />
        <LightboxBtn icon="folder-plus" title="Save to Vault" />
        <LightboxBtn icon="x" title="Close" onClick={onClose} />
      </div>
      <div onClick={onClose} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px 28px', minHeight: 0 }}>
        <img onClick={(e) => e.stopPropagation()} src={src} alt="" style={{ maxWidth: '92%', maxHeight: '100%', borderRadius: ARAD.md, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }} />
      </div>
    </div>
  );
}
function LightboxBtn({ icon, title, onClick }) {
  const [h, hb] = aHover();
  return (
    <button {...hb} onClick={onClick} title={title} style={{ width: 34, height: 34, borderRadius: ARAD.sm, border: 0, cursor: 'pointer',
      background: h ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.1s' }}>
      <AIcon name={icon} size={17} color="#FFFFFF" />
    </button>
  );
}

// ── ModelImage: an image the model generated ────────────────────────────────
function ModelImage({ src, prompt, tone = 'blue', host = 'Swiss cloud', tag = 'SWISS CLOUD', state = 'done', onOpen, width = 380 }) {
  const a = useA();
  return (
    <div style={{ width, maxWidth: '100%' }}>
      {state === 'generating' ? (
        <div style={{ position: 'relative', width: '100%', height: 240, borderRadius: ARAD.md, border: `1px solid ${a.border}`,
          background: a.sunken, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ position: 'absolute', inset: 0, animation: 'aShimmer 1.3s ease-in-out infinite',
            background: `linear-gradient(105deg, transparent 35%, ${a.hover} 50%, transparent 65%)` }} />
          <div style={{ position: 'relative', textAlign: 'center', color: a.subtle }}>
            <AIcon name="sparkles" size={22} color={a.link} />
            <div style={{ fontFamily: AFONT.sans, fontSize: 13, color: a.subtle, marginTop: 8 }}>Generating on {host}…</div>
          </div>
        </div>
      ) : (
        <button onClick={onOpen} style={{ display: 'block', padding: 0, border: 0, background: 'transparent', cursor: 'pointer', width: '100%', lineHeight: 0 }}>
          <img src={src} alt="" style={{ width: '100%', borderRadius: ARAD.md, border: `1px solid ${a.border}`, display: 'block' }} />
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <Lozenge tone={tone}>{tag}</Lozenge>
        <span style={{ fontFamily: AFONT.sans, fontSize: 12, color: a.subtlest, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <AIcon name="sparkles" size={12} color={a.subtlest} /> Generated · re-encrypted on return
        </span>
      </div>
      {prompt && (
        <div style={{ fontFamily: AFONT.sans, fontSize: 12.5, color: a.subtle, marginTop: 8, padding: '8px 11px', borderRadius: ARAD.sm,
          background: a.sunken, border: `1px solid ${a.border}`, lineHeight: 1.45 }}>
          <span style={{ color: a.subtlest }}>Prompt · </span>{prompt}
        </div>
      )}
      {state !== 'generating' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 8 }}>
          <AIconBtn name="download" size={15} title="Download" />
          <AIconBtn name="refresh-cw" size={15} title="Regenerate" />
          <AIconBtn name="copy-plus" size={15} title="Variations" />
          <span style={{ flex: 1 }} />
          <AButton appearance="subtle" icon="folder-plus" onClick={() => {}}>Save to Vault</AButton>
        </div>
      )}
    </div>
  );
}

// ── ComposerStaged: composer with attachments staged before send ────────────
function ComposerStaged() {
  const a = useA();
  const [items, setItems] = React.useState([
    { kind: 'img', src: IMG_RIPPLE },
    { kind: 'doc', name: 'lease.pdf' },
    { kind: 'doc', name: 'rent-ledger.csv', state: 'encrypting' },
  ]);
  const removeAt = (i) => setItems((xs) => xs.filter((_, j) => j !== i));
  return (
    <div style={{ width: '100%', maxWidth: 560 }}>
      <div style={{ background: a.surface, border: `2px solid ${a.brand}`, borderRadius: ARAD.sm, padding: '8px 8px 6px' }}>
        {items.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '2px 2px 8px' }}>
            {items.map((it, i) => it.kind === 'img'
              ? (
                <span key={i} style={{ position: 'relative', width: 56, height: 56, borderRadius: ARAD.sm, overflow: 'hidden', border: `1px solid ${a.border}` }}>
                  <img src={it.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button onClick={() => removeAt(i)} title="Remove" style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 9999, border: 0, cursor: 'pointer',
                    background: 'rgba(9,30,66,0.7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AIcon name="x" size={11} color="#FFFFFF" />
                  </button>
                  <span style={{ position: 'absolute', left: 3, bottom: 3, width: 16, height: 16, borderRadius: 9999, background: 'rgba(9,30,66,0.6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AIcon name="lock" size={9} color="#FFFFFF" />
                  </span>
                </span>
              )
              : <AttachChip key={i} name={it.name} state={it.state} onRemove={() => removeAt(i)} />)}
          </div>
        )}
        <div style={{ fontFamily: AFONT.sans, fontSize: 14, color: a.subtlest, padding: '4px 8px 10px' }}>Add a message…</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 2px' }}>
          <AIconBtn name="paperclip" title="Attach file" />
          <AIconBtn name="image" title="Attach image" />
          <AIconBtn name="folder-lock" title="Attach from Vault" />
          <span style={{ flex: 1 }} />
          <AButton appearance="primary" icon="send">Send</AButton>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 9 }}>
        <AIcon name="lock" size={11} color={a.subtlest} />
        <span style={{ fontFamily: AFONT.sans, fontSize: 11, color: a.subtlest }}>{items.length} attachment{items.length === 1 ? '' : 's'} sealed on this device before send</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function UserPhotoMsg({ images, text, onOpen }) {
  const a = useA();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, maxWidth: 360 }}>
      <ImageGrid images={images} onOpen={onOpen} width={320} />
      {text && (
        <div style={{ background: a.selectedBg, color: a.text, borderRadius: `${ARAD.md}px ${ARAD.md}px 2px ${ARAD.md}px`,
          padding: '11px 14px', fontFamily: AFONT.sans, fontSize: 14, lineHeight: 1.55 }}>{text}</div>
      )}
      <span style={{ fontFamily: AFONT.sans, fontSize: 11, color: a.subtlest, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <AIcon name="lock" size={11} color={a.subtlest} /> Encrypted · 14:36
      </span>
    </div>
  );
}

function ImagesSection() {
  const a = useA();
  const [box, setBox] = React.useState(null);
  const userImgs = [IMG_RIPPLE, IMG_COSMOS, IMG_RIPPLE];
  return (
    <DocSection id="images" eyebrow="Images" title="Images in conversation"
      intro="Photos a person uploads and pictures the model returns share one frame language: rounded, bordered, always wearing a lock. Uploads can be opened full-screen; generated images carry their provenance and the actions that matter.">

      <SubHead top={4}>User-uploaded — message bubble</SubHead>
      <Spec align="flex-start" title="ImageGrid + UserPhotoMsg" desc="One to four photos tile inside the user bubble; a fifth collapses into a +N overlay. Each cell opens the encrypted lightbox. Click any image below.">
        <Variant label="Single" align="stretch"><UserPhotoMsg images={[IMG_COSMOS]} text="Can you describe what’s in this photo?" onOpen={() => setBox({ src: IMG_COSMOS, name: 'night-sky.png' })} /></Variant>
        <Variant label="Three + count" align="stretch"><UserPhotoMsg images={[...userImgs, IMG_COSMOS, IMG_RIPPLE]} onOpen={(i) => setBox({ src: userImgs[i] || IMG_RIPPLE, name: 'upload-' + (i + 1) + '.jpg' })} /></Variant>
      </Spec>

      <SubHead>Model-generated image</SubHead>
      <Spec align="flex-start" title="ModelImage" desc="Provenance lozenge says where compute ran, with download / regenerate / variations / save-to-Vault. Generating state shimmers until the result is re-encrypted on return.">
        <Variant label="Generating" align="stretch"><ModelImage state="generating" host="Swiss cloud" width={300} /></Variant>
        <Variant label="Returned" align="stretch"><ModelImage src={IMG_COSMOS} tone="blue" tag="SWISS CLOUD" width={300} prompt="A calm starfield in soft violet, wide aspect" onOpen={() => setBox({ src: IMG_COSMOS, name: 'generated-starfield.png' })} /></Variant>
      </Spec>

      <SubHead>Staging in the composer</SubHead>
      <Spec align="flex-start" title="ComposerStaged" desc="Mixed images and documents staged above the input, each removable, with a running count of what’s been sealed. Reuses the live composer’s 2px-brand focused frame.">
        <ComposerStaged />
      </Spec>

      <SpecNote icon="image" tone="info">Sample imagery uses the project’s own assets. In production, thumbnails are decrypted to an in-memory blob URL only for display — the ciphertext is what’s stored.</SpecNote>

      {box && <Lightbox src={box.src} name={box.name} onClose={() => setBox(null)} />}
    </DocSection>
  );
}

Object.assign(window, { IMG_RIPPLE, IMG_COSMOS, ImageThumb, ImageGrid, ImageThumbInline, Lightbox, LightboxBtn, ModelImage, ComposerStaged, UserPhotoMsg, ImagesSection });
