import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  AlignCenterIcon,
  AlignLeftIcon,
  BulletListIcon,
  IndentIcon,
  LinkIcon,
  NumberListIcon,
  OutdentIcon,
  QuoteIcon,
  RedoIcon,
  UndoIcon,
} from './icons';

export type EditorValue = { html: string; text: string };

const TOGGLES = ['bold', 'italic', 'underline', 'strikeThrough'] as const;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "example.com" → "https://example.com". Only web and mail links are allowed. */
export function toLink(input: string) {
  const v = input.trim();
  if (!v) return null;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : v.includes('@') && !v.includes('/') ? `mailto:${v}` : `https://${v}`;
  return /^(https?:\/\/[^\s]+\.[^\s]+|mailto:[^\s@]+@[^\s@]+)$/i.test(url) ? url : null;
}

/**
 * The Figma's message box with its toolbar. Emails get the HTML, plus the plain text for mail apps that don't show formatting.
 * shortcut: built on the browser's own editing (document.execCommand). It's marked deprecated but works in every browser;
 * switch to an editor library if that changes or the toolbar needs much more.
 */
export function Editor({ onChange, placeholder }: { onChange: (v: EditorValue) => void; placeholder: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null); // the selection, kept while the size menu or link box has focus
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [empty, setEmpty] = useState(true);
  const [link, setLink] = useState<string | null>(null); // the link box's text while it's open

  useEffect(() => {
    document.execCommand('defaultParagraphSeparator', false, 'p'); // Enter starts a <p>, which mail apps space like paragraphs
    const onSelection = () => {
      const sel = document.getSelection();
      if (!sel?.rangeCount || !ref.current?.contains(sel.anchorNode)) return;
      saved.current = sel.getRangeAt(0).cloneRange();
      setActive(Object.fromEntries(TOGGLES.map((c) => [c, document.queryCommandState(c)])));
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const emit = () => {
    const el = ref.current!;
    const text = el.innerText.trim();
    setEmpty(!text);
    onChange({ html: el.innerHTML, text });
  };

  const run = (command: string, value?: string) => {
    ref.current!.focus();
    if (saved.current) {
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(saved.current);
    }
    document.execCommand(command, false, value);
    emit();
  };

  const addLink = () => {
    const url = toLink(link ?? '');
    if (!url) return;
    // With nothing selected, the address itself becomes the link text.
    if (!saved.current || saved.current.collapsed) run('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(url.replace(/^mailto:/, ''))}</a>`);
    else run('createLink', url);
    setLink(null);
  };

  return (
    <div className="mt-1 rounded-xl bg-field focus-within:ring-2 focus-within:ring-brand/40">
      <div role="toolbar" aria-label="Formatting" className="mx-3 mt-3 flex flex-wrap items-center gap-0.5 rounded-full bg-white px-2 py-1 text-muted">
        <Tool label="Undo" onClick={() => run('undo')}>
          <UndoIcon />
        </Tool>
        <Tool label="Redo" onClick={() => run('redo')}>
          <RedoIcon />
        </Tool>
        <Divider />
        <select
          aria-label="Text size"
          defaultValue=""
          onChange={(e) => {
            run('fontSize', e.target.value);
            e.target.value = '';
          }}
          className="h-7 rounded-md bg-transparent px-1 text-xs font-semibold hover:bg-field focus:outline-none"
        >
          <option value="" disabled>
            Tт
          </option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
        </select>
        <Divider />
        <Tool label="Bold" pressed={active.bold} onClick={() => run('bold')}>
          <b className="text-sm">B</b>
        </Tool>
        <Tool label="Italic" pressed={active.italic} onClick={() => run('italic')}>
          <i className="font-serif text-sm">I</i>
        </Tool>
        <Tool label="Underline" pressed={active.underline} onClick={() => run('underline')}>
          <span className="text-sm underline">U</span>
        </Tool>
        <Tool label="Strikethrough" pressed={active.strikeThrough} onClick={() => run('strikeThrough')}>
          <span className="text-sm line-through">S</span>
        </Tool>
        <Divider />
        <Tool label="Align left" onClick={() => run('justifyLeft')}>
          <AlignLeftIcon />
        </Tool>
        <Tool label="Align center" onClick={() => run('justifyCenter')}>
          <AlignCenterIcon />
        </Tool>
        <Divider />
        <Tool label="Numbered list" onClick={() => run('insertOrderedList')}>
          <NumberListIcon />
        </Tool>
        <Tool label="Bulleted list" onClick={() => run('insertUnorderedList')}>
          <BulletListIcon />
        </Tool>
        <Tool label="Decrease indent" onClick={() => run('outdent')}>
          <OutdentIcon />
        </Tool>
        <Tool label="Increase indent" onClick={() => run('indent')}>
          <IndentIcon />
        </Tool>
        <Tool label="Quote" onClick={() => run('formatBlock', 'blockquote')}>
          <QuoteIcon />
        </Tool>
        <Divider />
        <Tool label="Add link" pressed={link !== null} onClick={() => setLink((l) => (l === null ? '' : null))}>
          <LinkIcon />
        </Tool>
      </div>

      {link !== null && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg bg-white px-3 py-1.5">
          <input
            autoFocus
            aria-label="Link address"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); // add the link, don't send the form
                addLink();
              }
              if (e.key === 'Escape') setLink(null);
            }}
            placeholder="Paste a link, e.g. example.com"
            className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          />
          {link && !toLink(link) && <span className="text-xs text-stamp">Not a web or email address</span>}
          <button type="button" disabled={!toLink(link)} onClick={addLink} className="text-sm font-medium text-brand disabled:opacity-40">
            Add
          </button>
          <button type="button" onClick={() => setLink(null)} className="text-sm text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      )}

      <div className="relative">
        {empty && <span className="pointer-events-none absolute top-4 left-4 text-[15px] text-muted">{placeholder}</span>}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label="Message"
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onPaste={(e) => {
            // Pasted text arrives plain, so styles from Word or web pages don't end up in the emails.
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          }}
          className="min-h-72 p-4 text-[15px] leading-relaxed break-words focus:outline-none [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6"
        />
      </div>
    </div>
  );
}

/** A toolbar button. mousedown is cancelled so the message keeps its selection. */
function Tool({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid size-7 place-items-center rounded-md hover:bg-field hover:text-ink ${pressed ? 'bg-brand-soft text-brand' : ''}`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-1 h-4 w-px bg-line" />;
