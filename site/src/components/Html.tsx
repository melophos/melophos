// markup rendered from a repository file at build time. the wrapper takes no space in the layout (display: contents),
// so the rendered blocks sit in the page as they did when they were written straight into it
export function Html({ html, className }: { html: string; className?: string }) {
  return <div className={className ? `md ${className}` : "md"} dangerouslySetInnerHTML={{ __html: html }} />;
}
