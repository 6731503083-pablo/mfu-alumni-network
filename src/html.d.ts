// Wrangler bundles .html imports as text.
declare module '*.html' {
  const content: string;
  export default content;
}
