// Vite's `?raw` imports: a file's text, for tests that read the sources.
declare module '*?raw' {
  const text: string;
  export default text;
}
