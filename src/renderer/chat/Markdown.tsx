import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { cn } from '../cn'

/**
 * Markdown, rendered in the app's own vocabulary.
 *
 * Every element is mapped explicitly rather than left to a stylesheet, because the
 * defaults would be the one place in the app that ignores the theme: browser styles
 * bring their own margins and a blue link, and Tailwind's stock palette is switched
 * off here (`--color-*: initial`), so anything not written in tokens renders
 * unstyled rather than merely off-brand.
 *
 * `rehypeSanitize` is not optional. This text comes from a model, which means it can
 * be steered by whatever the model just read on the open web — a page fetched by
 * `read_url` is untrusted input that reaches this renderer. The default schema drops
 * raw HTML, scripts and `javascript:` URLs.
 *
 * `remarkGfm` earns its place on tables and task lists specifically: Bloom's builder
 * writes both, and they are exactly the structures that read worst as plain text.
 */
export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold text-ink">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-ink">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold tracking-wide text-ink uppercase">
              {children}
            </h3>
          ),
          ul: ({ children }) => (
            <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent-hi underline underline-offset-2 hover:text-accent"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-ink">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="border-0 border-t border-line" />,
          blockquote: ({ children }) => (
            <blockquote className="border-0 border-l-2 border-accent-deep pl-3 text-muted">
              {children}
            </blockquote>
          ),
          code: ({ className, children }) => {
            // react-markdown gives a fenced block a `language-*` class and inline
            // code none, which is the only reliable way to tell them apart here.
            const fenced = /language-/.test(className ?? '')
            if (!fenced) {
              return (
                <code className="rounded-control bg-ground px-1.5 py-0.5 font-mono text-[0.9em] text-accent-hi">
                  {children}
                </code>
              )
            }
            return <code className="font-mono text-meta">{children}</code>
          },
          pre: ({ children }) => (
            // The one place horizontal scrolling is allowed: a long line of code
            // must not widen the whole column and set the page scrolling sideways.
            <pre className="overflow-x-auto rounded-field border border-line bg-ground p-3 text-ink">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-0 border-b border-line px-2 py-1.5 text-meta font-semibold tracking-wide text-muted uppercase">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-0 border-b border-line px-2 py-1.5 align-top">
              {children}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
