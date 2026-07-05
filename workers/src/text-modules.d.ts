// Wrangler loads *.umd.txt as a string (see the Text rule in wrangler.jsonc).
declare module "*.umd.txt" {
  const content: string;
  export default content;
}
