import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { useEffect, useState, useRef } from 'react'
import {
  Bold, Italic, UnderlineIcon, Link2, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Undo, Redo, Code, Tags
} from 'lucide-react'

// All supported merge tags — must match the personalize() function in mailer.js
const MERGE_TAGS = [
  { tag: '{{name}}',        label: 'Name',        hint: 'Full display name' },
  { tag: '{{first_name}}',  label: 'First Name',  hint: 'First name only' },
  { tag: '{{last_name}}',   label: 'Last Name',   hint: 'Last name only' },
  { tag: '{{email}}',       label: 'Email',       hint: "Recipient's email" },
  { tag: '{{company}}',     label: 'Company',     hint: 'Company / organisation' },
  { tag: '{{unsubscribe}}', label: 'Unsubscribe', hint: 'Unsubscribe link URL' },
]

export default function RichEditor({ value, onChange, customTags = [] }) {
  const [showMergeTags, setShowMergeTags] = useState(false)
  const mergeRef = useRef(null)
  const allTags = [
    ...MERGE_TAGS,
    ...customTags.map(key => ({ tag: `{{${key}}}`, label: key, hint: 'From imported CSV' })),
  ]

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: true }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', false)
    }
  }, [value])

  // Close merge tag popover on outside click
  useEffect(() => {
    const handler = (e) => {
      if (mergeRef.current && !mergeRef.current.contains(e.target)) {
        setShowMergeTags(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!editor) return null

  const btn = (active, onClick, children, title) => (
    <button key={title} title={title} onMouseDown={e => { e.preventDefault(); onClick() }}
      style={{
        padding: '4px 7px', border: 'none', borderRadius: 4, cursor: 'pointer',
        background: active ? 'var(--accent-bg)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text)', fontSize: 12,
      }}>{children}</button>
  )

  const setLink = () => {
    const url = prompt('Enter URL:')
    if (url) editor.chain().focus().setLink({ href: url }).run()
  }

  const insertMergeTag = (tag) => {
    editor.chain().focus().insertContent(tag).run()
    setShowMergeTags(false)
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'visible' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '6px 8px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', borderRadius: 'var(--radius) var(--radius) 0 0' }}>
        {btn(editor.isActive('bold'),      () => editor.chain().focus().toggleBold().run(),        <Bold size={13} />,         'Bold')}
        {btn(editor.isActive('italic'),    () => editor.chain().focus().toggleItalic().run(),      <Italic size={13} />,       'Italic')}
        {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(),   <UnderlineIcon size={13} />,'Underline')}
        {btn(editor.isActive('code'),      () => editor.chain().focus().toggleCode().run(),        <Code size={13} />,         'Code')}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        {btn(editor.isActive({textAlign:'left'}),   () => editor.chain().focus().setTextAlign('left').run(),   <AlignLeft size={13} />,   'Align Left')}
        {btn(editor.isActive({textAlign:'center'}), () => editor.chain().focus().setTextAlign('center').run(), <AlignCenter size={13} />, 'Align Center')}
        {btn(editor.isActive({textAlign:'right'}),  () => editor.chain().focus().setTextAlign('right').run(),  <AlignRight size={13} />,  'Align Right')}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        {btn(editor.isActive('bulletList'),  () => editor.chain().focus().toggleBulletList().run(),  <List size={13} />,        'Bullet List')}
        {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={13} />, 'Ordered List')}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        {btn(editor.isActive('link'), setLink, <Link2 size={13} />, 'Add Link')}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        {btn(false, () => editor.chain().focus().undo().run(), <Undo size={13} />, 'Undo')}
        {btn(false, () => editor.chain().focus().redo().run(), <Redo size={13} />, 'Redo')}
        {/* Color picker */}
        <input type="color" title="Text Color" onInput={e => editor.chain().focus().setColor(e.target.value).run()}
          style={{ width: 24, height: 24, padding: 1, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 4 }} />

        {/* ── Merge Tags ── */}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        <div ref={mergeRef} style={{ position: 'relative' }}>
          <button
            title="Insert merge tag (personalisation)"
            onMouseDown={e => { e.preventDefault(); setShowMergeTags(v => !v) }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', border: 'none', borderRadius: 4, cursor: 'pointer',
              background: showMergeTags ? 'var(--accent-bg)' : 'transparent',
              color: showMergeTags ? 'var(--accent)' : 'var(--text)', fontSize: 12, fontWeight: 500,
            }}
          >
            <Tags size={13} /> Merge Tags
          </button>

          {showMergeTags && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              minWidth: 220, padding: 6,
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '4px 8px 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Click to insert at cursor
              </div>
              {allTags.map(({ tag, label, hint }) => (
                <button
                  key={tag}
                  onMouseDown={e => { e.preventDefault(); insertMergeTag(tag) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '6px 10px', border: 'none', borderRadius: 4,
                    background: 'transparent', cursor: 'pointer', textAlign: 'left',
                    color: 'var(--text)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent)' }}>{tag}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 10 }}>{hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <EditorContent editor={editor} style={{ minHeight: 200, padding: 12 }} />
      <style>{`
        .tiptap { outline: none; font-size: 14px; line-height: 1.6; color: var(--text-h); }
        .tiptap p { margin: 0 0 8px; }
        .tiptap ul, .tiptap ol { padding-left: 20px; margin-bottom: 8px; }
        .tiptap a { color: var(--accent); }
        .tiptap code { background: var(--bg3); padding: 2px 5px; border-radius: 4px; font-size: 12px; }
      `}</style>
    </div>
  )
}
